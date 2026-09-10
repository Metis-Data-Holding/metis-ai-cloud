package model

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

const (
	optionPrimaryKeyTmpTable = "options_pk_tmp"
	optionPrimaryKeyLockName = "new_api_options_pk"
	optionPrimaryKeyLockID   = 75820193
	optionLegacyTablePrefix  = "options_legacy_"
)

// migrateOptionPrimaryKey upgrades an old options table without a key
// constraint. Existing rows are never silently discarded: invalid data makes
// the migration fail before any live-table change is attempted.
func migrateOptionPrimaryKey(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("migrate options primary key: database is nil")
	}
	if !db.Migrator().HasTable(&Option{}) {
		return nil
	}
	return withOptionPrimaryKeyLock(db, func(locked *gorm.DB) error {
		if err := validateOptionKeys(locked); err != nil {
			return err
		}
		primary, err := optionsKeyIsPrimary(locked)
		if err != nil {
			return err
		}
		if primary {
			return nil
		}
		switch locked.Dialector.Name() {
		case "mysql":
			backup, err := nextOptionLegacyTableName(locked)
			if err != nil {
				return err
			}
			return migrateMySQLOptionPrimaryKey(locked, backup)
		case "postgres":
			backup, err := nextOptionLegacyTableName(locked)
			if err != nil {
				return err
			}
			return migratePostgresOptionPrimaryKey(locked, backup)
		case "sqlite":
			return rebuildSQLiteOptions(locked)
		default:
			return fmt.Errorf("migrate options primary key: unsupported database %q", locked.Dialector.Name())
		}
	})
}

func validateOptionKeys(db *gorm.DB) error {
	key := optionQuoteIdentifier(db, "key")
	table := optionQuoteIdentifier(db, "options")
	var invalid int64
	if err := db.Raw(fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE %s IS NULL OR %s = ?`, table, key, key), "").Scan(&invalid).Error; err != nil {
		return fmt.Errorf("validate options keys: %w", err)
	}
	if invalid > 0 {
		return fmt.Errorf("validate options keys: options contains %d null or empty key(s)", invalid)
	}

	var duplicates int64
	duplicateQuery := fmt.Sprintf(`
SELECT COUNT(*)
FROM (
  SELECT %s
  FROM %s
  GROUP BY %s
  HAVING COUNT(*) > 1
) AS duplicate_options`, key, table, key)
	if err := db.Raw(duplicateQuery).Scan(&duplicates).Error; err != nil {
		return fmt.Errorf("validate options keys: %w", err)
	}
	if duplicates > 0 {
		return fmt.Errorf("validate options keys: options contains %d duplicate key group(s)", duplicates)
	}
	return nil
}

func optionsKeyIsPrimary(db *gorm.DB) (bool, error) {
	if db.Dialector.Name() == "sqlite" {
		return sqliteOptionsKeyIsReady(db)
	}
	indexes, err := db.Migrator().GetIndexes(&Option{})
	if err != nil {
		return false, fmt.Errorf("inspect options indexes: %w", err)
	}
	for _, index := range indexes {
		columns := index.Columns()
		if len(columns) == 1 && strings.EqualFold(columns[0], "key") {
			if primary, ok := index.PrimaryKey(); ok && primary {
				return true, nil
			}
		}
	}
	columns, err := db.Migrator().ColumnTypes(&Option{})
	if err != nil {
		return false, fmt.Errorf("inspect options columns: %w", err)
	}
	for _, column := range columns {
		if strings.EqualFold(column.Name(), "key") {
			if primary, ok := column.PrimaryKey(); ok && primary {
				return true, nil
			}
		}
	}
	if db.Dialector.Name() != "postgres" {
		return false, nil
	}
	var count int64
	if err := db.Raw(`
SELECT count(*)
FROM pg_catalog.pg_constraint AS constraint_meta
JOIN pg_catalog.pg_attribute AS attribute_meta
  ON attribute_meta.attrelid = constraint_meta.conrelid
 AND attribute_meta.attnum = constraint_meta.conkey[1]
WHERE constraint_meta.conrelid = to_regclass('options')
  AND constraint_meta.contype = 'p'
  AND cardinality(constraint_meta.conkey) = 1
  AND attribute_meta.attname = 'key'`).Scan(&count).Error; err != nil {
		return false, fmt.Errorf("inspect options constraints: %w", err)
	}
	return count > 0, nil
}

func sqliteOptionsKeyIsReady(db *gorm.DB) (bool, error) {
	var columns []struct {
		Name    string `gorm:"column:name"`
		NotNull int    `gorm:"column:notnull"`
		PK      int    `gorm:"column:pk"`
	}
	if err := db.Raw(`PRAGMA table_info("options")`).Scan(&columns).Error; err != nil {
		return false, fmt.Errorf("inspect options SQLite columns: %w", err)
	}
	for _, column := range columns {
		if strings.EqualFold(column.Name, "key") {
			return column.PK == 1 && column.NotNull == 1, nil
		}
	}
	return false, nil
}

func withOptionPrimaryKeyLock(db *gorm.DB, fn func(*gorm.DB) error) error {
	if db == nil {
		return fmt.Errorf("lock options table: database is nil")
	}
	switch db.Dialector.Name() {
	case "mysql":
		return db.Connection(func(connDB *gorm.DB) error {
			if err := acquireMySQLOptionLock(connDB); err != nil {
				return err
			}
			defer releaseMySQLOptionLock(connDB)
			return fn(connDB)
		})
	case "postgres":
		return db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", optionPrimaryKeyLockID).Error; err != nil {
				return fmt.Errorf("lock options table: %w", err)
			}
			return fn(tx)
		})
	case "sqlite":
		return db.Transaction(func(tx *gorm.DB) error {
			if err := lockSQLiteOptions(tx); err != nil {
				return err
			}
			return fn(tx)
		})
	default:
		return db.Transaction(fn)
	}
}

func acquireMySQLOptionLock(db *gorm.DB) error {
	var acquired int64
	if err := db.Raw("SELECT GET_LOCK(?, 60)", optionPrimaryKeyLockName).Scan(&acquired).Error; err != nil {
		return fmt.Errorf("lock options table: %w", err)
	}
	if acquired != 1 {
		return fmt.Errorf("lock options table: timeout")
	}
	return nil
}

func releaseMySQLOptionLock(db *gorm.DB) {
	_ = execOptionMigrationSQL(db, "SELECT RELEASE_LOCK(?)", optionPrimaryKeyLockName)
}

func execOptionMigrationSQL(db *gorm.DB, query string, args ...interface{}) error {
	if db == nil || db.Statement == nil || db.Statement.ConnPool == nil {
		return fmt.Errorf("options migration cleanup: database connection is unavailable")
	}
	_, err := db.Statement.ConnPool.ExecContext(context.Background(), query, args...)
	return err
}

func lockSQLiteOptions(db *gorm.DB) error {
	if err := db.Exec(`UPDATE "options" SET "key" = "key" WHERE 1 = 0`).Error; err != nil {
		return fmt.Errorf("lock options table: %w", err)
	}
	return nil
}

func migrateMySQLOptionPrimaryKey(db *gorm.DB, backup string) error {
	if _, err := inspectMySQLOptionKeyType(db); err != nil {
		return err
	}
	if err := db.Exec("CREATE TABLE `" + backup + "` LIKE `options`").Error; err != nil {
		return fmt.Errorf("create options backup %s: %w", backup, err)
	}
	locked := false
	completed := false
	backupCopied := false
	defer func() {
		if locked {
			_ = execOptionMigrationSQL(db, "UNLOCK TABLES")
		}
		if !completed && !backupCopied {
			_ = execOptionMigrationSQL(db, "DROP TABLE IF EXISTS `"+backup+"`")
		}
	}()
	if err := db.Exec("LOCK TABLES `options` WRITE, `" + backup + "` WRITE").Error; err != nil {
		return fmt.Errorf("lock options tables: %w", err)
	}
	locked = true
	if err := validateOptionKeys(db); err != nil {
		return err
	}
	keyType, err := inspectMySQLOptionKeyType(db)
	if err != nil {
		return err
	}
	if err := db.Exec("INSERT INTO `" + backup + "` SELECT * FROM `options`").Error; err != nil {
		return fmt.Errorf("copy options backup %s: %w", backup, err)
	}
	backupCopied = true
	alter := "ALTER TABLE `options` ADD PRIMARY KEY (`key`), LOCK=EXCLUSIVE"
	if keyType.needsNarrowing {
		alter = "ALTER TABLE `options` MODIFY COLUMN `key` VARCHAR(191) NOT NULL, ADD PRIMARY KEY (`key`), LOCK=EXCLUSIVE"
	}
	if err := db.Exec(alter).Error; err != nil {
		return fmt.Errorf("add options primary key: %w", err)
	}
	completed = true
	return nil
}

type mySQLOptionKeyType struct {
	needsNarrowing bool
}

func inspectMySQLOptionKeyType(db *gorm.DB) (mySQLOptionKeyType, error) {
	columns, err := db.Migrator().ColumnTypes(&Option{})
	if err != nil {
		return mySQLOptionKeyType{}, fmt.Errorf("inspect options key type: %w", err)
	}
	for _, column := range columns {
		if !strings.EqualFold(column.Name(), "key") {
			continue
		}
		typeName := strings.ToLower(strings.TrimSpace(column.DatabaseTypeName()))
		switch typeName {
		case "tinytext", "text", "mediumtext", "longtext":
			if err := validateMySQLOptionKeyLength(db, typeName); err != nil {
				return mySQLOptionKeyType{}, err
			}
			return mySQLOptionKeyType{needsNarrowing: true}, nil
		case "blob", "tinyblob", "mediumblob", "longblob":
			return mySQLOptionKeyType{}, fmt.Errorf("migrate options primary key: MySQL key column type %s cannot be converted safely", typeName)
		default:
			needsNarrowing := false
			if length, ok := column.Length(); ok && length > 191 {
				needsNarrowing = true
				if err := validateMySQLOptionKeyLength(db, typeName); err != nil {
					return mySQLOptionKeyType{}, err
				}
			}
			return mySQLOptionKeyType{needsNarrowing: needsNarrowing}, nil
		}
	}
	return mySQLOptionKeyType{}, fmt.Errorf("migrate options primary key: MySQL key column is missing")
}

func validateMySQLOptionKeyLength(db *gorm.DB, typeName string) error {
	var tooLong int64
	if err := db.Raw("SELECT COUNT(*) FROM `options` WHERE CHAR_LENGTH(`key`) > 191").Scan(&tooLong).Error; err != nil {
		return fmt.Errorf("validate options key length: %w", err)
	}
	if tooLong > 0 {
		return fmt.Errorf("migrate options primary key: MySQL key column %s contains values longer than 191 characters", typeName)
	}
	return nil
}

func migratePostgresOptionPrimaryKey(db *gorm.DB, backup string) error {
	if err := db.Exec(`LOCK TABLE "options" IN ACCESS EXCLUSIVE MODE`).Error; err != nil {
		return fmt.Errorf("lock options table: %w", err)
	}
	if err := validateOptionKeys(db); err != nil {
		return err
	}
	if err := db.Exec(`CREATE TABLE "` + backup + `" (LIKE "options" INCLUDING ALL)`).Error; err != nil {
		return fmt.Errorf("create options backup %s: %w", backup, err)
	}
	if err := db.Exec(`INSERT INTO "` + backup + `" SELECT * FROM "options"`).Error; err != nil {
		return fmt.Errorf("copy options backup %s: %w", backup, err)
	}
	if err := db.Exec(`ALTER TABLE "options" ADD PRIMARY KEY ("key")`).Error; err != nil {
		return fmt.Errorf("add options primary key: %w", err)
	}
	return nil
}

func rebuildSQLiteOptions(db *gorm.DB) error {
	if db.Migrator().HasTable(optionPrimaryKeyTmpTable) {
		if err := db.Migrator().DropTable(optionPrimaryKeyTmpTable); err != nil {
			return fmt.Errorf("drop leftover %s: %w", optionPrimaryKeyTmpTable, err)
		}
	}
	if err := db.Table(optionPrimaryKeyTmpTable).Migrator().CreateTable(&Option{}); err != nil {
		return fmt.Errorf("create %s: %w", optionPrimaryKeyTmpTable, err)
	}
	tmpCreated := true
	defer func() {
		if tmpCreated && db.Migrator().HasTable(optionPrimaryKeyTmpTable) {
			_ = db.Migrator().DropTable(optionPrimaryKeyTmpTable)
		}
	}()

	var rows []Option
	if err := db.Order(`"key"`).Find(&rows).Error; err != nil {
		return fmt.Errorf("read options rows: %w", err)
	}
	if len(rows) > 0 {
		if err := db.Table(optionPrimaryKeyTmpTable).CreateInBatches(rows, 100).Error; err != nil {
			return fmt.Errorf("insert rebuilt options: %w", err)
		}
	}
	var written int64
	if err := db.Table(optionPrimaryKeyTmpTable).Count(&written).Error; err != nil {
		return fmt.Errorf("count rebuilt options: %w", err)
	}
	if int(written) != len(rows) {
		return fmt.Errorf("options rebuild wrote %d rows, want %d", written, len(rows))
	}

	backup, err := nextOptionLegacyTableName(db)
	if err != nil {
		return err
	}
	if err := swapOptionTables(db, optionPrimaryKeyTmpTable, backup); err != nil {
		return err
	}
	tmpCreated = false
	ready, err := optionsKeyIsPrimary(db)
	if err != nil {
		return err
	}
	if !ready {
		return fmt.Errorf("options table still has no non-null primary key after rebuild")
	}
	return nil
}

func nextOptionLegacyTableName(db *gorm.DB) (string, error) {
	for suffix := time.Now().UnixNano(); ; suffix++ {
		name := fmt.Sprintf("%s%d", optionLegacyTablePrefix, suffix)
		if !optionSafeIdent(name) {
			return "", fmt.Errorf("unsafe options backup table name")
		}
		if !db.Migrator().HasTable(name) {
			return name, nil
		}
	}
}

func swapOptionTables(db *gorm.DB, tmp, backup string) error {
	if !optionSafeIdent(tmp) || !optionSafeIdent(backup) {
		return fmt.Errorf("unsafe options table name")
	}
	if err := db.Migrator().RenameTable("options", backup); err != nil {
		return fmt.Errorf("rename options to %s: %w", backup, err)
	}
	if err := db.Migrator().RenameTable(tmp, "options"); err != nil {
		return fmt.Errorf("rename %s to options: %w", tmp, err)
	}
	return nil
}

func optionQuoteIdentifier(db *gorm.DB, identifier string) string {
	if db.Dialector.Name() == "mysql" {
		return "`" + identifier + "`"
	}
	return `"` + identifier + `"`
}

func optionSafeIdent(name string) bool {
	if name == "" {
		return false
	}
	return !strings.ContainsFunc(name, func(r rune) bool {
		return r != '_' && (r < '0' || r > '9') && (r < 'a' || r > 'z')
	})
}
