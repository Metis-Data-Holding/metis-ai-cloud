package model

import (
	"fmt"
	"os"
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

	for range 2 {
		require.NoError(t, migratePrefillGroupUniqueness(db))
		require.NoError(t, tableDB.AutoMigrate(&PrefillGroup{}))
	}

	var preserved PrefillGroup
	require.NoError(t, tableDB.Where("name = ?", "preserved-name").First(&preserved).Error)
	assert.Equal(t, "preserve me", preserved.Description)
	assert.True(t, tableDB.Migrator().HasIndex(&PrefillGroup{}, prefillGroupNameIndex))
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
WHERE schemaname = current_schema() AND tablename = 'other_groups' AND indexname = ?`, prefillGroupNameIndex).Scan(&indexCount).Error)
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
WHERE schemaname = 'public' AND tablename = 'prefill_groups' AND indexname = ?`, prefillGroupNameIndex).Scan(&indexCount).Error)
		assert.EqualValues(t, 1, indexCount)
	})

	tests := []struct {
		name               string
		prepareOld         func(*testing.T, *gorm.DB)
		blockedConstraints []string
		blockedIndexes     []string
		preservedIndexes   []string
		wantError          string
	}{
		{name: "fresh"},
		{
			name: "legacy_constraint",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"ALTER TABLE ? ADD CONSTRAINT ? UNIQUE (?)",
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: legacyPrefillGroupNameUnique},
					clause.Column{Name: "name"},
				).Error)
			},
		},
		{
			name: "legacy_standalone_index",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Migrator().DropIndex(&PrefillGroup{}, prefillGroupNameIndex))
				require.NoError(t, tx.Exec(
					"CREATE UNIQUE INDEX ? ON ? (?)",
					clause.Column{Name: legacyPrefillGroupNameUnique},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
				).Error)
			},
		},
		{
			name: "known_renamed_constraint",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"ALTER TABLE ? ADD CONSTRAINT ? UNIQUE (?)",
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "prefill_groups_name_key"},
					clause.Column{Name: "name"},
				).Error)
			},
		},
		{
			name: "known_renamed_index",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"CREATE UNIQUE INDEX ? ON ? (?)",
					clause.Column{Name: "idx_37606_uk_prefill_name"},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
				).Error)
			},
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
			name: "target_name_collision",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Migrator().DropIndex(&PrefillGroup{}, prefillGroupNameIndex))
				require.NoError(t, tx.Exec(
					"CREATE UNIQUE INDEX ? ON ? (?)",
					clause.Column{Name: prefillGroupNameIndex},
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "name"},
				).Error)
			},
		},
		{
			name: "target_constraint_name_collision",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Migrator().DropIndex(&PrefillGroup{}, prefillGroupNameIndex))
				require.NoError(t, tx.Exec(
					"ALTER TABLE ? ADD CONSTRAINT ? UNIQUE (?)",
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: prefillGroupNameIndex},
					clause.Column{Name: "name"},
				).Error)
			},
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
				var version int
				require.NoError(t, tx.Raw("SHOW server_version_num").Scan(&version).Error)
				if version < 150000 {
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
				var version int
				require.NoError(t, tx.Raw("SHOW server_version_num").Scan(&version).Error)
				if version < 110000 {
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
			name: "foreign_key_dependency_is_rejected",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"ALTER TABLE ? ADD CONSTRAINT ? UNIQUE (?)",
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: "prefill_groups_name_key"},
					clause.Column{Name: "name"},
				).Error)
				require.NoError(t, tx.Exec("CREATE TABLE referenced_groups (name varchar(64) REFERENCES prefill_groups(name))").Error)
			},
			blockedConstraints: []string{"prefill_groups_name_key"},
			wantError:          "unsupported global unique",
		},
		{
			name: "non_conflicting_indexes_are_preserved",
			prepareOld: func(t *testing.T, tx *gorm.DB) {
				t.Helper()
				require.NoError(t, tx.Exec(
					"ALTER TABLE ? ADD CONSTRAINT ? UNIQUE (?)",
					clause.Table{Name: "prefill_groups"},
					clause.Column{Name: legacyPrefillGroupNameUnique},
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
			preservedIndexes: []string{
				"keep_prefill_name_deleted_at",
				"keep_prefill_lower_name",
				"keep_prefill_deleted_name",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tx := db.Begin()
			require.NoError(t, tx.Error)
			t.Cleanup(func() { _ = tx.Rollback().Error })

			schemaName := fmt.Sprintf("prefill_group_migration_%d", time.Now().UnixNano())
			require.NoError(t, tx.Exec(
				"CREATE SCHEMA ?",
				clause.Table{Name: schemaName},
			).Error)
			require.NoError(t, tx.Exec(
				"SET LOCAL search_path TO ?",
				clause.Table{Name: schemaName},
			).Error)

			require.NoError(t, migratePrefillGroupUniqueness(tx))
			require.NoError(t, tx.AutoMigrate(&PrefillGroup{}))
			original := PrefillGroup{
				Name:        "shared-name",
				Type:        "model",
				Items:       JSONValue(`["gpt-test"]`),
				Description: "preserve me",
			}
			require.NoError(t, tx.Create(&original).Error)
			if test.prepareOld != nil {
				test.prepareOld(t, tx)
			}
			if test.wantError != "" {
				err := migratePrefillGroupUniqueness(tx)
				require.ErrorContains(t, err, test.wantError)
				for _, constraintName := range test.blockedConstraints {
					assert.True(t, tx.Migrator().HasConstraint(&PrefillGroup{}, constraintName))
				}
				for _, indexName := range test.blockedIndexes {
					assert.True(t, tx.Migrator().HasIndex(&PrefillGroup{}, indexName))
				}
				return
			}

			for range 2 {
				require.NoError(t, migratePrefillGroupUniqueness(tx))
				require.NoError(t, tx.AutoMigrate(&PrefillGroup{}))
			}
			for _, indexName := range test.preservedIndexes {
				assert.True(t, tx.Migrator().HasIndex(&PrefillGroup{}, indexName))
			}

			var preserved PrefillGroup
			require.NoError(t, tx.First(&preserved, original.Id).Error)
			assert.Equal(t, original.Name, preserved.Name)
			assert.Equal(t, original.Description, preserved.Description)

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
