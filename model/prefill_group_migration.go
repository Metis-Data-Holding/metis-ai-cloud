package model

import (
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const prefillGroupNameIndex = "uk_prefill_name"
const legacyPrefillGroupNameUnique = "idx_prefill_groups_name"

type prefillGroupUniquenessObject struct {
	Name       string `gorm:"column:name"`
	Definition string `gorm:"column:definition"`
	Safe       bool   `gorm:"column:safe"`
}

type conflictingPrefillGroupUniqueness struct {
	constraints []prefillGroupUniquenessObject
	indexes     []prefillGroupUniquenessObject
}

type prefillGroupNameIndexState struct {
	exists bool
	valid  bool
}

func (conflicts conflictingPrefillGroupUniqueness) empty() bool {
	return len(conflicts.constraints) == 0 && len(conflicts.indexes) == 0
}

func (conflicts conflictingPrefillGroupUniqueness) containsName(name string) bool {
	for _, constraint := range conflicts.constraints {
		if constraint.Name == name {
			return true
		}
	}
	for _, index := range conflicts.indexes {
		if index.Name == name {
			return true
		}
	}
	return false
}

func (conflicts conflictingPrefillGroupUniqueness) validateAutomaticMigrationScope() error {
	unexpectedConstraints := make([]string, 0)
	for _, object := range conflicts.constraints {
		if !object.Safe || !isKnownPrefillGroupLegacyUniqueness(object.Name) {
			unexpectedConstraints = append(unexpectedConstraints, fmt.Sprintf("%q (%s)", object.Name, object.Definition))
		}
	}
	unexpectedIndexes := make([]string, 0)
	for _, object := range conflicts.indexes {
		if !object.Safe || !isKnownPrefillGroupLegacyUniqueness(object.Name) {
			unexpectedIndexes = append(unexpectedIndexes, fmt.Sprintf("%q (%s)", object.Name, object.Definition))
		}
	}
	if len(unexpectedConstraints) == 0 && len(unexpectedIndexes) == 0 {
		return nil
	}
	return fmt.Errorf(
		"prefill_groups.name has unsupported global unique constraints %v and indexes %v; only known ordinary legacy objects can be migrated automatically to partial uniqueness",
		unexpectedConstraints,
		unexpectedIndexes,
	)
}

func isKnownPrefillGroupLegacyUniqueness(name string) bool {
	switch name {
	case legacyPrefillGroupNameUnique, "prefill_groups_name_key", "idx_37606_uk_prefill_name", prefillGroupNameIndex:
		return true
	default:
		return false
	}
}

func inspectConflictingPrefillGroupUniqueness(db *gorm.DB, tableName string) (conflictingPrefillGroupUniqueness, error) {
	var conflicts conflictingPrefillGroupUniqueness
	if err := db.Raw(`
SELECT constraint_meta.conname AS name,
       pg_get_constraintdef(constraint_meta.oid) AS definition,
       (
           NOT constraint_meta.condeferrable
           AND NOT constraint_meta.condeferred
           AND constraint_meta.convalidated
           AND index_meta.indisunique
           AND NOT index_meta.indisprimary
           AND index_meta.indisvalid
           AND index_meta.indisready
           AND index_meta.indpred IS NULL
           AND index_meta.indexprs IS NULL
           AND index_meta.indnatts = 1
           AND access_method.amname = 'btree'
           AND operator_class.opcdefault
           AND index_meta.indcollation[0] = attribute_meta.attcollation
           AND index_meta.indoption[0] = 0
           AND position('NULLS NOT DISTINCT' IN upper(pg_get_indexdef(index_meta.indexrelid))) = 0
           AND NOT EXISTS (
               SELECT 1
               FROM pg_catalog.pg_constraint AS foreign_key
               WHERE foreign_key.contype = 'f'
                 AND foreign_key.confrelid = constraint_meta.conrelid
                 AND cardinality(foreign_key.confkey) = 1
                 AND foreign_key.confkey[1] = constraint_meta.conkey[1]
           )
       ) AS safe
FROM pg_catalog.pg_constraint AS constraint_meta
JOIN pg_catalog.pg_index AS index_meta
  ON index_meta.indexrelid = constraint_meta.conindid
JOIN pg_catalog.pg_class AS index_class
  ON index_class.oid = index_meta.indexrelid
JOIN pg_catalog.pg_am AS access_method
  ON access_method.oid = index_class.relam
JOIN pg_catalog.pg_opclass AS operator_class
  ON operator_class.oid = index_meta.indclass[0]
JOIN pg_catalog.pg_attribute AS attribute_meta
  ON attribute_meta.attrelid = constraint_meta.conrelid
 AND attribute_meta.attnum = constraint_meta.conkey[1]
WHERE constraint_meta.conrelid = to_regclass(?)
  AND constraint_meta.contype = 'u'
  AND cardinality(constraint_meta.conkey) = 1
  AND attribute_meta.attname = ?
ORDER BY constraint_meta.conname`, tableName, "name").Scan(&conflicts.constraints).Error; err != nil {
		return conflicts, fmt.Errorf("inspect conflicting prefill group unique constraints: %w", err)
	}

	var serverVersion int
	if err := db.Raw("SELECT current_setting('server_version_num')::int").Scan(&serverVersion).Error; err != nil {
		return conflicts, fmt.Errorf("inspect PostgreSQL server version: %w", err)
	}
	keyColumnCount := "index_meta.indnatts"
	if serverVersion >= 110000 {
		keyColumnCount = "index_meta.indnkeyatts"
	}
	indexQuery := fmt.Sprintf(`
SELECT index_class.relname AS name,
       pg_get_indexdef(index_meta.indexrelid) AS definition,
       (
           index_meta.indisvalid
           AND index_meta.indisready
           AND index_meta.indnatts = 1
           AND access_method.amname = 'btree'
           AND operator_class.opcdefault
           AND index_meta.indcollation[0] = attribute_meta.attcollation
           AND index_meta.indoption[0] = 0
           AND position('NULLS NOT DISTINCT' IN upper(pg_get_indexdef(index_meta.indexrelid))) = 0
           AND NOT EXISTS (
               SELECT 1
               FROM pg_catalog.pg_constraint AS foreign_key
               WHERE foreign_key.contype = 'f'
                 AND foreign_key.confrelid = index_meta.indrelid
                 AND cardinality(foreign_key.confkey) = 1
                 AND foreign_key.confkey[1] = attribute_meta.attnum
           )
       ) AS safe
FROM pg_catalog.pg_index AS index_meta
JOIN pg_catalog.pg_class AS index_class
  ON index_class.oid = index_meta.indexrelid
JOIN pg_catalog.pg_am AS access_method
  ON access_method.oid = index_class.relam
JOIN pg_catalog.pg_opclass AS operator_class
  ON operator_class.oid = index_meta.indclass[0]
JOIN pg_catalog.pg_attribute AS attribute_meta
  ON attribute_meta.attrelid = index_meta.indrelid
 AND attribute_meta.attnum = index_meta.indkey[0]
WHERE index_meta.indrelid = to_regclass(?)
  AND index_meta.indisunique
  AND NOT index_meta.indisprimary
  AND index_meta.indpred IS NULL
  AND index_meta.indexprs IS NULL
  AND %s = 1
  AND attribute_meta.attname = ?
  AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_meta
      WHERE constraint_meta.conindid = index_meta.indexrelid
  )
ORDER BY index_class.relname`, keyColumnCount)
	if err := db.Raw(indexQuery, tableName, "name").Scan(&conflicts.indexes).Error; err != nil {
		return conflicts, fmt.Errorf("inspect conflicting prefill group unique indexes: %w", err)
	}

	return conflicts, nil
}

func inspectPrefillGroupNameIndex(db *gorm.DB, tableName string) (prefillGroupNameIndexState, error) {
	var state struct {
		Exists bool `gorm:"column:index_exists"`
		Valid  bool `gorm:"column:index_valid"`
	}
	if err := db.Raw(`
SELECT count(*) > 0 AS index_exists,
       COALESCE(bool_or(
           index_meta.indrelid = to_regclass(?)
           AND index_meta.indisunique
           AND index_meta.indisvalid
           AND index_meta.indisready
           AND NOT index_meta.indisprimary
           AND index_meta.indexprs IS NULL
           AND index_meta.indnatts = 1
           AND access_method.amname = 'btree'
           AND operator_class.opcdefault
           AND index_meta.indcollation[0] = attribute_meta.attcollation
           AND index_meta.indoption[0] = 0
           AND position('NULLS NOT DISTINCT' IN upper(pg_get_indexdef(index_meta.indexrelid))) = 0
           AND attribute_meta.attname = ?
           AND pg_get_expr(index_meta.indpred, index_meta.indrelid) = '(deleted_at IS NULL)'
       ), false) AS index_valid
FROM pg_catalog.pg_index AS index_meta
JOIN pg_catalog.pg_class AS index_class
  ON index_class.oid = index_meta.indexrelid
JOIN pg_catalog.pg_namespace AS index_namespace
  ON index_namespace.oid = index_class.relnamespace
JOIN pg_catalog.pg_am AS access_method
  ON access_method.oid = index_class.relam
JOIN pg_catalog.pg_opclass AS operator_class
  ON operator_class.oid = index_meta.indclass[0]
LEFT JOIN pg_catalog.pg_attribute AS attribute_meta
  ON attribute_meta.attrelid = index_meta.indrelid
 AND attribute_meta.attnum = index_meta.indkey[0]
WHERE index_namespace.nspname = COALESCE(
          (
              SELECT table_namespace.nspname
              FROM pg_catalog.pg_class AS table_class
              JOIN pg_catalog.pg_namespace AS table_namespace
                ON table_namespace.oid = table_class.relnamespace
              WHERE table_class.oid = to_regclass(?)
          ),
          current_schema()
      )
  AND index_class.relname = ?`, tableName, "name", tableName, prefillGroupNameIndex).Scan(&state).Error; err != nil {
		return prefillGroupNameIndexState{}, fmt.Errorf("inspect prefill group partial unique index: %w", err)
	}
	return prefillGroupNameIndexState{exists: state.Exists, valid: state.Valid}, nil
}

// migratePrefillGroupUniqueness replaces global PostgreSQL uniqueness on name
// before AutoMigrate inspects the column. Match the definition rather than the
// object name, which can change across older schemas and database imports.
// Composite, expression and partial indexes retain their separate semantics.
func migratePrefillGroupUniqueness(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("migrate prefill group uniqueness: database is nil")
	}
	if db.Dialector.Name() != "postgres" {
		return nil
	}

	statement := &gorm.Statement{DB: db}
	if err := statement.Parse(&PrefillGroup{}); err != nil {
		return fmt.Errorf("parse prefill group schema: %w", err)
	}
	tableName := statement.Schema.Table
	conflicts, err := inspectConflictingPrefillGroupUniqueness(db, tableName)
	if err != nil {
		return err
	}
	targetIndex, err := inspectPrefillGroupNameIndex(db, tableName)
	if err != nil {
		return err
	}
	if targetIndex.exists && !targetIndex.valid && !conflicts.containsName(prefillGroupNameIndex) {
		return fmt.Errorf("prefill group index %q has an unexpected definition", prefillGroupNameIndex)
	}
	if conflicts.empty() {
		return nil
	}
	if err := conflicts.validateAutomaticMigrationScope(); err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		migrator := tx.Migrator()
		if !migrator.HasTable(&PrefillGroup{}) {
			return nil
		}

		if err := tx.Exec(
			"LOCK TABLE ? IN ACCESS EXCLUSIVE MODE",
			clause.Table{Name: tableName},
		).Error; err != nil {
			return fmt.Errorf("lock prefill groups for uniqueness migration: %w", err)
		}

		conflicts, err := inspectConflictingPrefillGroupUniqueness(tx, tableName)
		if err != nil {
			return err
		}
		targetIndex, err := inspectPrefillGroupNameIndex(tx, tableName)
		if err != nil {
			return err
		}
		if targetIndex.exists && !targetIndex.valid && !conflicts.containsName(prefillGroupNameIndex) {
			return fmt.Errorf("prefill group index %q has an unexpected definition", prefillGroupNameIndex)
		}
		if conflicts.empty() {
			return nil
		}
		if err := conflicts.validateAutomaticMigrationScope(); err != nil {
			return err
		}
		if !migrator.HasColumn(&PrefillGroup{}, "DeletedAt") {
			if err := migrator.AddColumn(&PrefillGroup{}, "DeletedAt"); err != nil {
				return fmt.Errorf("add prefill groups deleted_at column: %w", err)
			}
		}

		// A legacy global object may already use the target partial-index name.
		// Drop only catalog-validated known objects under the table lock; the
		// transaction restores them if creating the replacement fails.
		for _, constraint := range conflicts.constraints {
			if err := migrator.DropConstraint(&PrefillGroup{}, constraint.Name); err != nil {
				return fmt.Errorf("drop conflicting prefill group constraint %q: %w", constraint.Name, err)
			}
		}
		for _, index := range conflicts.indexes {
			if err := migrator.DropIndex(&PrefillGroup{}, index.Name); err != nil {
				return fmt.Errorf("drop conflicting prefill group index %q: %w", index.Name, err)
			}
		}

		targetIndex, err = inspectPrefillGroupNameIndex(tx, tableName)
		if err != nil {
			return err
		}
		if !targetIndex.exists {
			if err := migrator.CreateIndex(&PrefillGroup{}, prefillGroupNameIndex); err != nil {
				return fmt.Errorf("create prefill group partial unique index: %w", err)
			}
			targetIndex, err = inspectPrefillGroupNameIndex(tx, tableName)
			if err != nil {
				return err
			}
		}
		if !targetIndex.valid {
			return fmt.Errorf("prefill group index %q has an unexpected definition", prefillGroupNameIndex)
		}

		return nil
	})
}
