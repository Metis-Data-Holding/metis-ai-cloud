package model

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func newLegacyOptionsDB(t *testing.T, rows ...map[string]any) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "options.db")), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE TABLE options ("key" TEXT, "value" TEXT)`).Error)
	for _, row := range rows {
		require.NoError(t, db.Table("options").Create(row).Error)
	}
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func optionTableRows(t *testing.T, db *gorm.DB, table string) []map[string]any {
	t.Helper()
	var rows []map[string]any
	require.NoError(t, db.Table(table).Find(&rows).Error)
	return rows
}

func optionTableHasPrimaryKey(t *testing.T, db *gorm.DB) bool {
	t.Helper()
	var columns []struct {
		Name string
		PK   int
	}
	require.NoError(t, db.Raw(`PRAGMA table_info(options)`).Scan(&columns).Error)
	for _, column := range columns {
		if strings.EqualFold(column.Name, "key") {
			return column.PK == 1
		}
	}
	return false
}

func optionTableKeyNotNull(t *testing.T, db *gorm.DB) bool {
	t.Helper()
	var columns []struct {
		Name    string `gorm:"column:name"`
		NotNull int    `gorm:"column:notnull"`
	}
	require.NoError(t, db.Raw(`PRAGMA table_info(options)`).Scan(&columns).Error)
	for _, column := range columns {
		if strings.EqualFold(column.Name, "key") {
			return column.NotNull == 1
		}
	}
	return false
}

func optionLegacyBackups(t *testing.T, db *gorm.DB) []string {
	t.Helper()
	var names []string
	require.NoError(t, db.Raw(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? ORDER BY name`, optionLegacyTablePrefix+"%").Pluck("name", &names).Error)
	return names
}

func TestMigrateOptionPrimaryKeyRejectsDuplicateKeysWithoutChangingLiveTable(t *testing.T) {
	db := newLegacyOptionsDB(t,
		map[string]any{"key": "ModelRatio", "value": "first"},
		map[string]any{"key": "ModelRatio", "value": "second"},
	)

	err := migrateOptionPrimaryKey(db)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "duplicate")
	assert.False(t, optionTableHasPrimaryKey(t, db))
	assert.Len(t, optionTableRows(t, db, "options"), 2)
	assert.Empty(t, optionLegacyBackups(t, db))
}

func TestMigrateOptionPrimaryKeyRejectsEmptyAndNullKeysWithoutChangingLiveTable(t *testing.T) {
	tests := []struct {
		name string
		key  any
	}{
		{name: "empty", key: ""},
		{name: "null", key: nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db := newLegacyOptionsDB(t,
				map[string]any{"key": test.key, "value": "unsafe"},
				map[string]any{"key": "valid", "value": "kept"},
			)

			err := migrateOptionPrimaryKey(db)
			require.Error(t, err)
			assert.Contains(t, err.Error(), "empty")
			assert.False(t, optionTableHasPrimaryKey(t, db))
			assert.Len(t, optionTableRows(t, db, "options"), 2)
			assert.Empty(t, optionLegacyBackups(t, db))
		})
	}
}

func TestMigrateOptionPrimaryKeyRebuildsSQLiteWithBackupAndIsIdempotent(t *testing.T) {
	db := newLegacyOptionsDB(t,
		map[string]any{"key": "ModelRatio", "value": "value"},
		map[string]any{"key": "ImageRatio", "value": "image"},
	)

	require.NoError(t, migrateOptionPrimaryKey(db))
	assert.True(t, optionTableHasPrimaryKey(t, db))
	assert.Equal(t, []map[string]any{
		{"key": "ImageRatio", "value": "image"},
		{"key": "ModelRatio", "value": "value"},
	}, sortedOptionRows(t, db, "options"))
	backups := optionLegacyBackups(t, db)
	require.Len(t, backups, 1)
	assert.Equal(t, []map[string]any{
		{"key": "ImageRatio", "value": "image"},
		{"key": "ModelRatio", "value": "value"},
	}, sortedOptionRows(t, db, backups[0]))

	require.NoError(t, migrateOptionPrimaryKey(db))
	assert.Equal(t, backups, optionLegacyBackups(t, db))
}

func TestMigrateOptionPrimaryKeyRejectsRawNullAfterSQLiteMigration(t *testing.T) {
	db := newLegacyOptionsDB(t, map[string]any{"key": "valid", "value": "kept"})
	require.NoError(t, migrateOptionPrimaryKey(db))
	assert.True(t, optionTableKeyNotNull(t, db))
	assert.Error(t, db.Exec(`INSERT INTO options ("key", "value") VALUES (NULL, ?)`, "unsafe").Error)
}

func TestMigrateOptionPrimaryKeyRebuildsNullableSQLitePrimaryKey(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "options.db")), &gorm.Config{})
	require.NoError(t, err)
	dbSQL, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = dbSQL.Close() })
	require.NoError(t, db.Exec(`CREATE TABLE options ("key" TEXT PRIMARY KEY, "value" TEXT)`).Error)
	require.NoError(t, db.Table("options").Create(map[string]any{"key": "valid", "value": "kept"}).Error)
	assert.True(t, optionTableHasPrimaryKey(t, db))
	assert.False(t, optionTableKeyNotNull(t, db))

	require.NoError(t, migrateOptionPrimaryKey(db))
	assert.True(t, optionTableHasPrimaryKey(t, db))
	assert.True(t, optionTableKeyNotNull(t, db))
	backups := optionLegacyBackups(t, db)
	require.Len(t, backups, 1)
	require.NoError(t, migrateOptionPrimaryKey(db))
	assert.Equal(t, backups, optionLegacyBackups(t, db))
}

func sortedOptionRows(t *testing.T, db *gorm.DB, table string) []map[string]any {
	t.Helper()
	var rows []map[string]any
	require.NoError(t, db.Table(table).Order(optionQuoteIdentifier(db, "key")).Find(&rows).Error)
	return rows
}

func TestUpdateOptionDoesNotUpdateOptionMapWhenFirstOrCreateFails(t *testing.T) {
	db := newLegacyOptionsDB(t)
	require.NoError(t, db.Exec(`CREATE TRIGGER reject_option_insert BEFORE INSERT ON options BEGIN SELECT RAISE(ABORT, 'reject option insert'); END`).Error)
	previousDB, previousMap := DB, common.OptionMap
	DB = db
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMap = previousMap
	})

	err := UpdateOption("new-key", "new-value")
	require.Error(t, err)
	assert.ErrorContains(t, err, "reject option insert")
	assert.NotContains(t, common.OptionMap, "new-key")
}

func TestUpdateOptionDoesNotUpdateOptionMapWhenSaveFails(t *testing.T) {
	db := newLegacyOptionsDB(t, map[string]any{"key": "existing", "value": "old"})
	require.NoError(t, db.Exec(`CREATE TRIGGER reject_option_update BEFORE UPDATE ON options BEGIN SELECT RAISE(ABORT, 'reject option update'); END`).Error)
	previousDB, previousMap := DB, common.OptionMap
	DB = db
	common.OptionMap = map[string]string{"existing": "old"}
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMap = previousMap
	})

	err := UpdateOption("existing", "new")
	require.Error(t, err)
	assert.ErrorContains(t, err, "reject option update")
	assert.Equal(t, "old", common.OptionMap["existing"])
}

func TestUpdateOptionRejectsEmptyKeyBeforeDatabaseWrite(t *testing.T) {
	db := newLegacyOptionsDB(t)
	previousDB, previousMap := DB, common.OptionMap
	DB = db
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMap = previousMap
	})

	err := UpdateOption("", "unsafe")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "option key")
	assert.Empty(t, optionTableRows(t, db, "options"))
	assert.NotContains(t, common.OptionMap, "")
}

func TestUpdateOptionsBulkRejectsEmptyKeyBeforeDatabaseWrite(t *testing.T) {
	db := newLegacyOptionsDB(t)
	previousDB, previousMap := DB, common.OptionMap
	DB = db
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMap = previousMap
	})

	err := UpdateOptionsBulk(map[string]string{"": "unsafe", "valid": "must-not-write"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "option key")
	assert.Empty(t, optionTableRows(t, db, "options"))
	assert.NotContains(t, common.OptionMap, "valid")
}

func TestMigrateOptionPrimaryKeyFailureDoesNotDropSourceRows(t *testing.T) {
	db := newLegacyOptionsDB(t,
		map[string]any{"key": "same", "value": "one"},
		map[string]any{"key": "same", "value": "two"},
	)
	before := optionTableRows(t, db, "options")

	err := migrateOptionPrimaryKey(db)
	require.Error(t, err)
	assert.Equal(t, before, optionTableRows(t, db, "options"))
	assert.False(t, optionTableHasPrimaryKey(t, db))
}

func TestOptionPrimaryKeyMigrationReturnsErrorForNilDatabase(t *testing.T) {
	err := migrateOptionPrimaryKey(nil)
	require.Error(t, err)
	assert.Equal(t, "migrate options primary key: database is nil", err.Error())
}

func TestOptionPrimaryKeyMigrationErrorMessageIncludesTableState(t *testing.T) {
	db := newLegacyOptionsDB(t, map[string]any{"key": "", "value": "bad"})
	err := migrateOptionPrimaryKey(db)
	require.Error(t, err)
	assert.Contains(t, fmt.Sprintf("%v", err), "options")
}

func TestOptionPrimaryKeyMigrationLockBlocksConcurrentSQLiteOptionWrite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "options.db")), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE TABLE options ("key" TEXT, "value" TEXT)`).Error)
	dbSQL, err := db.DB()
	require.NoError(t, err)
	dbSQL.SetMaxOpenConns(2)
	t.Cleanup(func() { _ = dbSQL.Close() })

	previousDB, previousMap := DB, common.OptionMap
	DB = db
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMap = previousMap
	})

	lockHeld := make(chan struct{})
	releaseLock := make(chan struct{})
	migrationDone := make(chan error, 1)
	go func() {
		migrationDone <- withOptionPrimaryKeyLock(db, func(_ *gorm.DB) error {
			close(lockHeld)
			<-releaseLock
			return nil
		})
	}()
	<-lockHeld

	writeDone := make(chan error, 1)
	go func() { writeDone <- UpdateOption("concurrent", "value") }()
	select {
	case err := <-writeDone:
		t.Fatalf("option write completed while migration lock was held: %v", err)
	case <-time.After(100 * time.Millisecond):
	}

	close(releaseLock)
	require.NoError(t, <-migrationDone)
	require.NoError(t, <-writeDone)
	assert.Equal(t, "value", common.OptionMap["concurrent"])
}

func TestInitDBNonMasterMigratesOptionsBeforeReturning(t *testing.T) {
	previousDB := DB
	previousSQLitePath := common.SQLitePath
	previousMaster := common.IsMasterNode
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()
	t.Cleanup(func() {
		if DB != nil && DB != previousDB {
			if sqlDB, err := DB.DB(); err == nil {
				_ = sqlDB.Close()
			}
		}
		DB = previousDB
		common.SQLitePath = previousSQLitePath
		common.IsMasterNode = previousMaster
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
	})

	dbPath := filepath.Join(t.TempDir(), "non-master-options.db")
	seedDB, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, seedDB.Exec(`CREATE TABLE options ("key" TEXT, "value" TEXT)`).Error)
	require.NoError(t, seedDB.Table("options").Create([]map[string]any{
		{"key": "duplicate", "value": "first"},
		{"key": "duplicate", "value": "second"},
	}).Error)
	seedSQLDB, err := seedDB.DB()
	require.NoError(t, err)
	require.NoError(t, seedSQLDB.Close())

	common.SQLitePath = dbPath
	common.IsMasterNode = false
	t.Setenv("SQL_DSN", "local")
	err = InitDB()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "duplicate key")

	verifyDB, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	require.NoError(t, err)
	verifySQLDB, err := verifyDB.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = verifySQLDB.Close() })
	assert.False(t, optionTableHasPrimaryKey(t, verifyDB))
	assert.Equal(t, []map[string]any{
		{"key": "duplicate", "value": "first"},
		{"key": "duplicate", "value": "second"},
	}, optionTableRows(t, verifyDB, "options"))
}

type optionSQLBackend struct {
	dialect string
	env     string
}

const optionMigrationTestDatabasePrefix = "metis_options_pk_test"

func openOptionSQLBackend(t *testing.T, backend optionSQLBackend) *gorm.DB {
	t.Helper()
	dsn := os.Getenv(backend.env)
	if dsn == "" {
		t.Skipf("%s is not configured; real %s migration was not executed", backend.env, backend.dialect)
	}
	t.Setenv("OPTION_MIGRATION_TEST_DSN", dsn)
	db, _, err := chooseDB("OPTION_MIGRATION_TEST_DSN", false)
	require.NoError(t, err)
	dbSQL, err := db.DB()
	require.NoError(t, err)
	dbSQL.SetMaxOpenConns(4)
	t.Cleanup(func() { _ = dbSQL.Close() })
	requireDisposableOptionSQLScope(t, db, backend)
	cleanupOptionSQLBackend(t, db, backend)
	t.Cleanup(func() { cleanupOptionSQLBackend(t, db, backend) })
	return db
}

func requireDisposableOptionSQLScope(t *testing.T, db *gorm.DB, backend optionSQLBackend) {
	t.Helper()
	if os.Getenv("OPTION_MIGRATION_ALLOW_DESTRUCTIVE_TESTS") != "1" {
		t.Skip("destructive SQL migration tests require OPTION_MIGRATION_ALLOW_DESTRUCTIVE_TESTS=1")
	}
	var databaseName, schemaName string
	var row *sql.Row
	if backend.dialect == "mysql" {
		row = db.Raw("SELECT DATABASE(), DATABASE()").Row()
	} else {
		row = db.Raw("SELECT current_database(), current_schema()").Row()
	}
	if err := row.Scan(&databaseName, &schemaName); err != nil {
		t.Skipf("cannot verify disposable SQL test scope: %v", err)
	}
	if !strings.HasPrefix(databaseName, optionMigrationTestDatabasePrefix) && !strings.HasPrefix(schemaName, optionMigrationTestDatabasePrefix) {
		t.Skipf("refusing destructive SQL test in database=%q schema=%q; use a disposable name prefixed with %s", databaseName, schemaName, optionMigrationTestDatabasePrefix)
	}
}

func cleanupOptionSQLBackend(t *testing.T, db *gorm.DB, backend optionSQLBackend) {
	t.Helper()
	_ = db.Exec("DROP TABLE IF EXISTS options").Error
	var backups []string
	if backend.dialect == "mysql" {
		_ = db.Raw("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE ?", optionLegacyTablePrefix+"%").Pluck("table_name", &backups).Error
	} else {
		_ = db.Raw("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE ?", optionLegacyTablePrefix+"%").Pluck("table_name", &backups).Error
	}
	for _, backup := range backups {
		if backend.dialect == "mysql" {
			_ = db.Exec("DROP TABLE IF EXISTS `" + backup + "`").Error
		} else {
			_ = db.Exec("DROP TABLE IF EXISTS \"" + backup + "\"").Error
		}
	}
}

func createLegacyOptionTable(t *testing.T, db *gorm.DB, backend optionSQLBackend) {
	t.Helper()
	if backend.dialect == "mysql" {
		require.NoError(t, db.Exec("CREATE TABLE options (`key` VARCHAR(255), `value` TEXT)").Error)
		return
	}
	require.NoError(t, db.Exec(`CREATE TABLE options ("key" TEXT, "value" TEXT)`).Error)
}

func optionSQLBackupNames(t *testing.T, db *gorm.DB, backend optionSQLBackend) []string {
	t.Helper()
	var backups []string
	if backend.dialect == "mysql" {
		require.NoError(t, db.Raw("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE ? ORDER BY table_name", optionLegacyTablePrefix+"%").Pluck("table_name", &backups).Error)
	} else {
		require.NoError(t, db.Raw("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE ? ORDER BY table_name", optionLegacyTablePrefix+"%").Pluck("table_name", &backups).Error)
	}
	return backups
}

func holdOptionSQLTableLock(t *testing.T, db *gorm.DB, backend optionSQLBackend, held, release chan struct{}) <-chan error {
	t.Helper()
	done := make(chan error, 1)
	go func() {
		if backend.dialect == "mysql" {
			done <- db.Connection(func(connDB *gorm.DB) error {
				if err := connDB.Exec("LOCK TABLES `options` WRITE").Error; err != nil {
					return err
				}
				close(held)
				<-release
				return connDB.Exec("UNLOCK TABLES").Error
			})
			return
		}
		done <- db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Exec(`LOCK TABLE "options" IN ACCESS EXCLUSIVE MODE`).Error; err != nil {
				return err
			}
			close(held)
			<-release
			return nil
		})
	}()
	return done
}

func TestOptionPrimaryKeyMigrationConfiguredSQLBackends(t *testing.T) {
	for _, backend := range []optionSQLBackend{
		{dialect: "mysql", env: "TEST_MYSQL_DSN"},
		{dialect: "postgres", env: "TEST_POSTGRES_DSN"},
	} {
		t.Run(backend.dialect, func(t *testing.T) {
			t.Run("legacy_success_backup", func(t *testing.T) {
				db := openOptionSQLBackend(t, backend)
				createLegacyOptionTable(t, db, backend)
				require.NoError(t, db.Table("options").Create([]map[string]any{
					{"key": "ModelRatio", "value": "value"},
					{"key": "ImageRatio", "value": "image"},
				}).Error)

				require.NoError(t, migrateOptionPrimaryKey(db))
				primary, err := optionsKeyIsPrimary(db)
				require.NoError(t, err)
				assert.True(t, primary)
				backups := optionSQLBackupNames(t, db, backend)
				require.Len(t, backups, 1)
				assert.Equal(t, sortedOptionRows(t, db, "options"), sortedOptionRows(t, db, backups[0]))
			})

			t.Run("duplicate_key_fail_closed", func(t *testing.T) {
				db := openOptionSQLBackend(t, backend)
				createLegacyOptionTable(t, db, backend)
				require.NoError(t, db.Table("options").Create([]map[string]any{
					{"key": "same", "value": "first"},
					{"key": "same", "value": "second"},
				}).Error)
				before := sortedOptionRows(t, db, "options")

				err := migrateOptionPrimaryKey(db)
				require.Error(t, err)
				assert.Equal(t, before, sortedOptionRows(t, db, "options"))
				assert.Empty(t, optionSQLBackupNames(t, db, backend))
			})

			t.Run("empty_key_fail_closed", func(t *testing.T) {
				db := openOptionSQLBackend(t, backend)
				createLegacyOptionTable(t, db, backend)
				require.NoError(t, db.Table("options").Create([]map[string]any{
					{"key": "", "value": "empty"},
					{"key": "valid", "value": "kept"},
				}).Error)
				before := sortedOptionRows(t, db, "options")

				err := migrateOptionPrimaryKey(db)
				require.Error(t, err)
				assert.Equal(t, before, sortedOptionRows(t, db, "options"))
				assert.Empty(t, optionSQLBackupNames(t, db, backend))
			})

			t.Run("null_key_fail_closed", func(t *testing.T) {
				db := openOptionSQLBackend(t, backend)
				createLegacyOptionTable(t, db, backend)
				require.NoError(t, db.Table("options").Create([]map[string]any{
					{"key": nil, "value": "null"},
					{"key": "valid", "value": "kept"},
				}).Error)
				before := sortedOptionRows(t, db, "options")

				err := migrateOptionPrimaryKey(db)
				require.Error(t, err)
				assert.Contains(t, err.Error(), "null or empty")
				assert.Equal(t, before, sortedOptionRows(t, db, "options"))
				assert.Empty(t, optionSQLBackupNames(t, db, backend))
			})

			t.Run("idempotent", func(t *testing.T) {
				db := openOptionSQLBackend(t, backend)
				createLegacyOptionTable(t, db, backend)
				require.NoError(t, db.Table("options").Create(map[string]any{"key": "one", "value": "value"}).Error)
				require.NoError(t, migrateOptionPrimaryKey(db))
				backups := optionSQLBackupNames(t, db, backend)
				require.Len(t, backups, 1)
				require.NoError(t, migrateOptionPrimaryKey(db))
				assert.Equal(t, backups, optionSQLBackupNames(t, db, backend))
			})

			t.Run("fresh_auto_migrate_noop", func(t *testing.T) {
				db := openOptionSQLBackend(t, backend)
				require.NoError(t, db.AutoMigrate(&Option{}))
				require.NoError(t, migrateOptionPrimaryKey(db))
				primary, err := optionsKeyIsPrimary(db)
				require.NoError(t, err)
				assert.True(t, primary)
				assert.Empty(t, optionSQLBackupNames(t, db, backend))
			})

			t.Run("database_lock_blocks_write", func(t *testing.T) {
				db := openOptionSQLBackend(t, backend)
				require.NoError(t, db.AutoMigrate(&Option{}))
				previousDB, previousMap := DB, common.OptionMap
				DB = db
				common.OptionMap = map[string]string{}
				t.Cleanup(func() {
					DB = previousDB
					common.OptionMap = previousMap
				})

				held := make(chan struct{})
				release := make(chan struct{})
				lockDone := holdOptionSQLTableLock(t, db, backend, held, release)
				<-held
				writeDone := make(chan error, 1)
				go func() { writeDone <- UpdateOption("concurrent", "value") }()
				var writeErr error
				writeFinishedWhileLocked := false
				select {
				case writeErr = <-writeDone:
					writeFinishedWhileLocked = true
				case <-time.After(100 * time.Millisecond):
				}
				close(release)
				require.NoError(t, <-lockDone)
				if !writeFinishedWhileLocked {
					writeErr = <-writeDone
				}
				assert.False(t, writeFinishedWhileLocked)
				require.NoError(t, writeErr)
			})

			t.Run("mysql_text_key_safe_conversion", func(t *testing.T) {
				if backend.dialect != "mysql" {
					t.Skip("legacy TEXT key conversion is MySQL-specific")
				}
				db := openOptionSQLBackend(t, backend)
				require.NoError(t, db.Exec("CREATE TABLE options (`key` TEXT, `value` TEXT)").Error)
				require.NoError(t, db.Table("options").Create(map[string]any{"key": "text-key", "value": "value"}).Error)

				require.NoError(t, migrateOptionPrimaryKey(db))
				primary, err := optionsKeyIsPrimary(db)
				require.NoError(t, err)
				assert.True(t, primary)
				var dataType string
				var charLength int64
				row := db.Raw("SELECT data_type, character_maximum_length FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'options' AND column_name = 'key'").Row()
				require.NoError(t, row.Scan(&dataType, &charLength))
				assert.Equal(t, "varchar", strings.ToLower(dataType))
				assert.EqualValues(t, 191, charLength)
			})

			t.Run("mysql_key_over_191_fail_closed", func(t *testing.T) {
				if backend.dialect != "mysql" {
					t.Skip("MySQL legacy index-length compatibility is MySQL-specific")
				}
				db := openOptionSQLBackend(t, backend)
				createLegacyOptionTable(t, db, backend)
				longKey := strings.Repeat("k", 192)
				require.NoError(t, db.Table("options").Create(map[string]any{"key": longKey, "value": "value"}).Error)
				before := optionTableRows(t, db, "options")

				err := migrateOptionPrimaryKey(db)
				require.Error(t, err)
				assert.Contains(t, err.Error(), "longer than 191")
				assert.Equal(t, before, optionTableRows(t, db, "options"))
				assert.Empty(t, optionSQLBackupNames(t, db, backend))
			})

			t.Run("unconvertible_key_keeps_live_table", func(t *testing.T) {
				if backend.dialect != "mysql" {
					t.Skip("PostgreSQL DDL failure injection requires a disposable role with restricted ALTER permission")
				}
				db := openOptionSQLBackend(t, backend)
				require.NoError(t, db.Exec("CREATE TABLE options (`key` BLOB, `value` TEXT)").Error)
				require.NoError(t, db.Table("options").Create(map[string]any{"key": []byte("binary-key"), "value": "value"}).Error)
				before := optionTableRows(t, db, "options")

				err := migrateOptionPrimaryKey(db)
				require.Error(t, err)
				assert.Contains(t, err.Error(), "cannot be converted safely")
				assert.Equal(t, before, optionTableRows(t, db, "options"))
				assert.Empty(t, optionSQLBackupNames(t, db, backend))
			})

			t.Run("existing_primary_key_ddl_failure_preserves_source", func(t *testing.T) {
				db := openOptionSQLBackend(t, backend)
				if backend.dialect == "mysql" {
					require.NoError(t, db.Exec("CREATE TABLE options (`id` BIGINT PRIMARY KEY AUTO_INCREMENT, `key` VARCHAR(255), `value` TEXT)").Error)
				} else {
					require.NoError(t, db.Exec(`CREATE TABLE options ("id" BIGSERIAL PRIMARY KEY, "key" TEXT, "value" TEXT)`).Error)
				}
				require.NoError(t, db.Table("options").Create(map[string]any{"key": "valid", "value": "kept"}).Error)
				before := sortedOptionRows(t, db, "options")
				var blocker *sql.Conn
				if backend.dialect == "mysql" {
					sqlDB, err := db.DB()
					require.NoError(t, err)
					blocker, err = sqlDB.Conn(context.Background())
					require.NoError(t, err)
					t.Cleanup(func() { _ = blocker.Close() })
				}

				err := migrateOptionPrimaryKey(db)
				require.Error(t, err)
				require.ErrorContains(t, err, "add options primary key")
				assert.Equal(t, before, sortedOptionRows(t, db, "options"))
				if backend.dialect == "mysql" {
					var acquired int64
					require.NoError(t, blocker.QueryRowContext(context.Background(), "SELECT GET_LOCK(?, 0)", optionPrimaryKeyLockName).Scan(&acquired))
					require.EqualValues(t, 1, acquired)
					var released int64
					require.NoError(t, blocker.QueryRowContext(context.Background(), "SELECT RELEASE_LOCK(?)", optionPrimaryKeyLockName).Scan(&released))
					require.EqualValues(t, 1, released)
					_, err = blocker.ExecContext(context.Background(), "SET SESSION lock_wait_timeout = 0")
					require.NoError(t, err)
					_, err = blocker.ExecContext(context.Background(), "INSERT INTO options (`key`, `value`) VALUES ('after-failure', 'kept')")
					require.NoError(t, err)
					assert.Len(t, optionTableRows(t, db, "options"), len(before)+1)
				}
				backups := optionSQLBackupNames(t, db, backend)
				if backend.dialect == "mysql" {
					require.Len(t, backups, 1)
					assert.Equal(t, before, sortedOptionRows(t, db, backups[0]))
				} else {
					assert.Empty(t, backups)
				}
			})
		})
	}
}
