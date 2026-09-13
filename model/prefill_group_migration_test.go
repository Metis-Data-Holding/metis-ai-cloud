package model

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func testPrefillGroupMigrationNonPostgreSQL(t *testing.T, db *gorm.DB) {
	t.Helper()
	var version string
	versionQuery := "SELECT version()"
	if db.Dialector.Name() == "sqlite" {
		versionQuery = "SELECT sqlite_version()"
	}
	require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
	t.Logf("%s version: %s", db.Dialector.Name(), version)

	tableName := fmt.Sprintf("prefill_group_migration_%d", time.Now().UnixNano())
	t.Cleanup(func() { _ = db.Migrator().DropTable(tableName) })
	tableDB := db.Table(tableName)
	require.NoError(t, tableDB.AutoMigrate(&PrefillGroup{}))
	require.NoError(t, tableDB.Create(&PrefillGroup{
		Name:        "preserved-name",
		Type:        "model",
		Items:       JSONValue(`["gpt-test"]`),
		Description: "preserve me",
	}).Error)

	recorder := &migrationSQLRecorder{}
	for pass := range 2 {
		recorder.reset()
		require.NoError(t, migratePrefillGroupUniqueness(db.Session(&gorm.Session{Logger: recorder})))
		require.NoError(t, tableDB.Session(&gorm.Session{Logger: recorder}).AutoMigrate(&PrefillGroup{}))
		if pass == 1 {
			assert.Empty(t, recorder.schemaMutations(), "repeated startup must not change the schema")
		}
	}

	var preserved PrefillGroup
	require.NoError(t, tableDB.Where("name = ?", "preserved-name").First(&preserved).Error)
	assert.Equal(t, "preserve me", preserved.Description)
	assert.JSONEq(t, `["gpt-test"]`, string(preserved.Items))
	assert.True(t, tableDB.Migrator().HasIndex(&PrefillGroup{}, prefillGroupNameIndex))
	require.Error(t, tableDB.Create(&PrefillGroup{Name: preserved.Name, Type: "model"}).Error)
}

func TestMigratePrefillGroupUniquenessSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	testPrefillGroupMigrationNonPostgreSQL(t, db)
}

func TestMigratePrefillGroupUniquenessMySQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}

	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testPrefillGroupMigrationNonPostgreSQL(t, db)
}

func TestMigratePrefillGroupUniquenessPostgreSQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not configured")
	}

	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true,
	}), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })

	var version string
	require.NoError(t, db.Raw("SELECT version()").Scan(&version).Error)
	t.Log(version)

	for _, existingTable := range []bool{false, true} {
		name := "fresh_schema"
		if existingTable {
			name = "existing_prefill_groups"
		}
		t.Run("target_name_on_other_table_"+name, func(t *testing.T) {
			tx := db.Begin()
			require.NoError(t, tx.Error)
			t.Cleanup(func() { _ = tx.Rollback().Error })

			schemaName := fmt.Sprintf("prefill_group_collision_%d", time.Now().UnixNano())
			require.NoError(t, tx.Exec("CREATE SCHEMA ?", clause.Table{Name: schemaName}).Error)
			require.NoError(t, tx.Exec("SET LOCAL search_path TO ?", clause.Table{Name: schemaName}).Error)
			if existingTable {
				require.NoError(t, tx.AutoMigrate(&PrefillGroup{}))
				require.NoError(t, tx.Migrator().DropIndex(&PrefillGroup{}, prefillGroupNameIndex))
			}
			require.NoError(t, tx.Exec("CREATE TABLE other_groups (name varchar(64))").Error)
			require.NoError(t, tx.Exec(
				"CREATE INDEX ? ON other_groups (name)",
				clause.Column{Name: prefillGroupNameIndex},
			).Error)

			err := migratePrefillGroupUniqueness(tx)
			require.ErrorContains(t, err, "unexpected definition")
			var indexCount int64
			require.NoError(t, tx.Raw(`
SELECT count(*) FROM pg_catalog.pg_indexes
WHERE schemaname = current_schema() AND tablename = 'other_groups' AND indexname = ?`,
				prefillGroupNameIndex,
			).Scan(&indexCount).Error)
			assert.EqualValues(t, 1, indexCount)
		})
	}

	t.Run("target_index_uses_resolved_table_schema", func(t *testing.T) {
		tx := db.Begin()
		require.NoError(t, tx.Error)
		t.Cleanup(func() { _ = tx.Rollback().Error })

		require.NoError(t, tx.Exec("SET LOCAL search_path TO public").Error)
		require.NoError(t, tx.AutoMigrate(&PrefillGroup{}))
		require.NoError(t, tx.Migrator().DropIndex(&PrefillGroup{}, prefillGroupNameIndex))
		require.NoError(t, tx.Exec(
			"CREATE INDEX ? ON ? (?)",
			clause.Column{Name: prefillGroupNameIndex},
			clause.Table{Name: "prefill_groups"},
			clause.Column{Name: "name"},
		).Error)

		shadowSchema := fmt.Sprintf("prefill_group_shadow_%d", time.Now().UnixNano())
		require.NoError(t, tx.Exec("CREATE SCHEMA ?", clause.Table{Name: shadowSchema}).Error)
		require.NoError(t, tx.Exec("SELECT set_config('search_path', ?, true)", shadowSchema+", public").Error)

		err := migratePrefillGroupUniqueness(tx)
		require.ErrorContains(t, err, "unexpected definition")
		var indexCount int64
		require.NoError(t, tx.Raw(`
SELECT count(*) FROM pg_catalog.pg_indexes
WHERE schemaname = 'public' AND tablename = 'prefill_groups' AND indexname = ?`,
			prefillGroupNameIndex,
		).Scan(&indexCount).Error)
		assert.EqualValues(t, 1, indexCount)
	})

	type indexDefinition struct {
		Name       string `gorm:"column:indexname"`
		Definition string `gorm:"column:indexdef"`
	}

	tests := []struct {
		name                string
		constraints         []string
		indexes             []string
		blockedConstraints  []string
		blockedIndexes      []string
		replacePartialIndex bool
		withoutDeletedAt    bool
		prepareOld          func(*testing.T, *gorm.DB)
		wantError           string
	}{
		{name: "fresh"},
		{
			name:        "legacy_constraint",
			constraints: []string{legacyPrefillGroupNameUnique},
		},
		{
			name:                "legacy_standalone_index",
			indexes:             []string{legacyPrefillGroupNameUnique},
			replacePartialIndex: true,
		},
		{
			name:        "known_renamed_objects",
			constraints: []string{legacyPrefillGroupNameUnique, "prefill_groups_name_key"},
			indexes:     []string{"idx_37606_uk_prefill_name"},
		},
		{
			name:                "imported_index_without_soft_delete_column",
			indexes:             []string{"idx_37606_uk_prefill_name"},
			replacePartialIndex: true,
			withoutDeletedAt:    true,
		},
		{
			name:                "global_index_uses_target_name",
			indexes:             []string{prefillGroupNameIndex},
			replacePartialIndex: true,
		},
		{
			name:                "global_constraint_uses_target_name",
			constraints:         []string{prefillGroupNameIndex},
			replacePartialIndex: true,
		},
		{
			name: "similar_unconfirmed_index_name_is_rejected",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"CREATE UNIQUE INDEX ? ON ? (?)",
					clause.Column{Name: "idx_99999_uk_prefill_name"},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
				).Error)
			},
			blockedIndexes: []string{"idx_99999_uk_prefill_name"},
			wantError:      "unsupported global unique",
		},
		{
			name: "deferrable_constraint_is_rejected",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"ALTER TABLE ? ADD CONSTRAINT ? UNIQUE (?) DEFERRABLE INITIALLY DEFERRED",
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "prefill_groups_name_key"},
					clause.Column{Name: "name"},
				).Error)
			},
			blockedConstraints: []string{"prefill_groups_name_key"},
			wantError:          "unsupported global unique",
		},
		{
			name: "nulls_not_distinct_constraint_is_rejected",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				var serverVersion int
				require.NoError(t, tx.Raw("SHOW server_version_num").Scan(&serverVersion).Error)
				if serverVersion < 150000 {
					t.Skip("NULLS NOT DISTINCT requires PostgreSQL 15+")
				}
				require.NoError(t, tx.Exec(
					"ALTER TABLE ? ADD CONSTRAINT ? UNIQUE NULLS NOT DISTINCT (?)",
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "prefill_groups_name_key"},
					clause.Column{Name: "name"},
				).Error)
			},
			blockedConstraints: []string{"prefill_groups_name_key"},
			wantError:          "unsupported global unique",
		},
		{
			name: "non_default_order_is_rejected",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"CREATE UNIQUE INDEX ? ON ? (? DESC)",
					clause.Column{Name: "prefill_groups_name_key"},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
				).Error)
			},
			blockedIndexes: []string{"prefill_groups_name_key"},
			wantError:      "unsupported global unique",
		},
		{
			name: "non_default_opclass_is_rejected",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"CREATE UNIQUE INDEX ? ON ? (? text_pattern_ops)",
					clause.Column{Name: "prefill_groups_name_key"},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
				).Error)
			},
			blockedIndexes: []string{"prefill_groups_name_key"},
			wantError:      "unsupported global unique",
		},
		{
			name: "non_default_collation_is_rejected",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"CREATE UNIQUE INDEX ? ON ? (? COLLATE \"C\")",
					clause.Column{Name: "prefill_groups_name_key"},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
				).Error)
			},
			blockedIndexes: []string{"prefill_groups_name_key"},
			wantError:      "unsupported global unique",
		},
		{
			name: "included_column_is_rejected",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				var serverVersion int
				require.NoError(t, tx.Raw("SHOW server_version_num").Scan(&serverVersion).Error)
				if serverVersion < 110000 {
					t.Skip("included columns require PostgreSQL 11+")
				}
				require.NoError(t, tx.Exec(
					"CREATE UNIQUE INDEX ? ON ? (?) INCLUDE (?)",
					clause.Column{Name: "prefill_groups_name_key"},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
					clause.Column{Name: "type"},
				).Error)
			},
			blockedIndexes: []string{"prefill_groups_name_key"},
			wantError:      "unsupported global unique",
		},
		{
			name:        "foreign_key_dependency_is_rejected",
			constraints: []string{"prefill_groups_name_key"},
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"CREATE TABLE referenced_groups (name varchar(64) REFERENCES prefill_groups(name))",
				).Error)
				require.NoError(t, tx.Exec("INSERT INTO referenced_groups (name) VALUES (?)", "shared-name").Error)
			},
			replacePartialIndex: true,
			withoutDeletedAt:    true,
			wantError:           "unsupported global unique",
		},
		{
			name:        "non_conflicting_indexes_are_preserved",
			constraints: []string{"prefill_groups_name_key"},
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"CREATE INDEX ? ON ? (?)",
					clause.Column{Name: "keep_prefill_name"},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
				).Error)
				require.NoError(t, tx.Exec(
					"CREATE UNIQUE INDEX ? ON ? (?, ?)",
					clause.Column{Name: "keep_prefill_name_deleted_at"},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
					clause.Column{Name: "deleted_at"},
				).Error)
				require.NoError(t, tx.Exec(
					"CREATE UNIQUE INDEX ? ON ? (lower(?)) WHERE deleted_at IS NULL",
					clause.Column{Name: "keep_prefill_lower_name"},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
				).Error)
				require.NoError(t, tx.Exec(
					"CREATE UNIQUE INDEX ? ON ? (?) WHERE deleted_at IS NOT NULL",
					clause.Column{Name: "keep_prefill_deleted_name"},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
				).Error)
			},
		},
		{
			name:                "unexpected_target_definition_rolls_back",
			constraints:         []string{"prefill_groups_name_key"},
			indexes:             []string{"idx_37606_uk_prefill_name"},
			replacePartialIndex: true,
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"CREATE INDEX ? ON ? (?)",
					clause.Column{Name: prefillGroupNameIndex},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "type"},
				).Error)
			},
			wantError: "unexpected definition",
		},
		{
			name:                "target_name_on_other_table_rolls_back",
			indexes:             []string{"idx_37606_uk_prefill_name"},
			replacePartialIndex: true,
			withoutDeletedAt:    true,
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec("CREATE TABLE other_groups (name varchar(64))").Error)
				require.NoError(t, tx.Exec(
					"CREATE INDEX ? ON other_groups (name)",
					clause.Column{Name: prefillGroupNameIndex},
				).Error)
			},
			wantError: "unexpected definition",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tx := db.Begin()
			require.NoError(t, tx.Error)
			t.Cleanup(func() { _ = tx.Rollback().Error })

			schemaName := fmt.Sprintf("prefill_group_migration_%d", time.Now().UnixNano())
			require.NoError(t, tx.Exec("CREATE SCHEMA ?", clause.Table{Name: schemaName}).Error)
			require.NoError(t, tx.Exec("SET LOCAL search_path TO ?", clause.Table{Name: schemaName}).Error)
			require.NoError(t, migratePrefillGroupUniqueness(tx))
			require.NoError(t, tx.AutoMigrate(&PrefillGroup{}))

			original := PrefillGroup{
				Name:        "shared-name",
				Type:        "model",
				Items:       JSONValue(`["gpt-test"]`),
				Description: "preserve me",
			}
			require.NoError(t, tx.Create(&original).Error)
			if test.replacePartialIndex {
				require.NoError(t, tx.Migrator().DropIndex(&PrefillGroup{}, prefillGroupNameIndex))
			}
			if test.withoutDeletedAt {
				require.NoError(t, tx.Migrator().DropColumn(&PrefillGroup{}, "DeletedAt"))
			}
			for _, constraintName := range test.constraints {
				require.NoError(t, tx.Exec(
					"ALTER TABLE ? ADD CONSTRAINT ? UNIQUE (?)",
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: constraintName},
					clause.Column{Name: "name"},
				).Error)
			}
			for _, indexName := range test.indexes {
				require.NoError(t, tx.Exec(
					"CREATE UNIQUE INDEX ? ON ? (?)",
					clause.Column{Name: indexName},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
				).Error)
			}
			if test.prepareOld != nil {
				test.prepareOld(t, tx)
			}

			var oldIndexes []indexDefinition
			require.NoError(t, tx.Raw(`
SELECT indexname, indexdef FROM pg_catalog.pg_indexes
WHERE schemaname = current_schema() AND tablename = 'prefill_groups'
ORDER BY indexname`).Scan(&oldIndexes).Error)
			if test.wantError != "" {
				err := migratePrefillGroupUniqueness(tx)
				require.ErrorContains(t, err, test.wantError)
				for _, constraintName := range append(test.constraints, test.blockedConstraints...) {
					assert.True(t, tx.Migrator().HasConstraint(&PrefillGroup{}, constraintName))
				}
				for _, indexName := range test.blockedIndexes {
					assert.True(t, tx.Migrator().HasIndex(&PrefillGroup{}, indexName))
				}
				var restoredIndexes []indexDefinition
				require.NoError(t, tx.Raw(`
SELECT indexname, indexdef FROM pg_catalog.pg_indexes
WHERE schemaname = current_schema() AND tablename = 'prefill_groups'
ORDER BY indexname`).Scan(&restoredIndexes).Error)
				assert.Equal(t, oldIndexes, restoredIndexes)
				assert.Equal(t, !test.withoutDeletedAt, tx.Migrator().HasColumn(&PrefillGroup{}, "DeletedAt"))
				var preserved PrefillGroup
				require.NoError(t, tx.Unscoped().First(&preserved, original.Id).Error)
				assert.Equal(t, original, preserved)
				return
			}

			recorder := &migrationSQLRecorder{}
			migrationDB := tx.Session(&gorm.Session{Logger: recorder})
			for pass := range 2 {
				recorder.reset()
				require.NoError(t, migratePrefillGroupUniqueness(migrationDB))
				require.NoError(t, migrationDB.AutoMigrate(&PrefillGroup{}))
				if pass == 1 {
					assert.Empty(t, recorder.schemaMutations(), "repeated startup must not change the schema")
				}
			}
			for _, oldIndex := range oldIndexes {
				if oldIndex.Name == prefillGroupNameIndex ||
					slices.Contains(test.constraints, oldIndex.Name) ||
					slices.Contains(test.indexes, oldIndex.Name) {
					continue
				}
				var definition string
				require.NoError(t, tx.Raw(`
SELECT indexdef FROM pg_catalog.pg_indexes
WHERE schemaname = current_schema() AND indexname = ?`, oldIndex.Name).Scan(&definition).Error)
				assert.Equal(t, oldIndex.Definition, definition)
			}

			var preserved PrefillGroup
			require.NoError(t, tx.First(&preserved, original.Id).Error)
			assert.Equal(t, original, preserved)

			var globalConstraintCount int64
			require.NoError(t, tx.Raw(`
SELECT count(*)
FROM pg_catalog.pg_constraint AS constraint_meta
WHERE constraint_meta.conrelid = to_regclass('prefill_groups')
  AND constraint_meta.contype = 'u'
  AND cardinality(constraint_meta.conkey) = 1
  AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_meta
      WHERE attribute_meta.attrelid = constraint_meta.conrelid
        AND attribute_meta.attnum = constraint_meta.conkey[1]
        AND attribute_meta.attname = 'name'
  )`).Scan(&globalConstraintCount).Error)
			assert.Zero(t, globalConstraintCount)

			var globalIndexCount int64
			require.NoError(t, tx.Raw(`
SELECT count(*)
FROM pg_catalog.pg_index AS index_meta
JOIN pg_catalog.pg_attribute AS attribute_meta
  ON attribute_meta.attrelid = index_meta.indrelid
 AND attribute_meta.attnum = index_meta.indkey[0]
WHERE index_meta.indrelid = to_regclass('prefill_groups')
  AND index_meta.indisunique
  AND NOT index_meta.indisprimary
  AND index_meta.indpred IS NULL
  AND index_meta.indexprs IS NULL
  AND index_meta.indnatts = 1
  AND attribute_meta.attname = 'name'`).Scan(&globalIndexCount).Error)
			assert.Zero(t, globalIndexCount)

			var targetIndexDefinition string
			require.NoError(t, tx.Raw(`
SELECT indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = current_schema()
  AND tablename = 'prefill_groups'
  AND indexname = ?`, prefillGroupNameIndex).Scan(&targetIndexDefinition).Error)
			assert.Contains(t, strings.ToLower(targetIndexDefinition), "unique index")
			assert.Contains(t, strings.ToLower(targetIndexDefinition), "where (deleted_at is null)")

			duplicateError := tx.Transaction(func(duplicateTx *gorm.DB) error {
				return duplicateTx.Create(&PrefillGroup{
					Name:  original.Name,
					Type:  "model",
					Items: JSONValue(`[]`),
				}).Error
			})
			require.Error(t, duplicateError)

			require.NoError(t, tx.Delete(&original).Error)
			require.NoError(t, tx.Create(&PrefillGroup{
				Name:  original.Name,
				Type:  "model",
				Items: JSONValue(`[]`),
			}).Error)
			var totalRows int64
			require.NoError(t, tx.Unscoped().Model(&PrefillGroup{}).Count(&totalRows).Error)
			assert.EqualValues(t, 2, totalRows)
		})
	}
}
