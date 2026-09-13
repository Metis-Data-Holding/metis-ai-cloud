package model

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestMain(m *testing.M) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		panic("failed to open test db: " + err.Error())
	}
	DB = db
	LOG_DB = db

	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.BatchUpdateEnabled = false
	common.LogConsumeEnabled = true
	initCol()

	sqlDB, err := db.DB()
	if err != nil {
		panic("failed to get sql.DB: " + err.Error())
	}
	sqlDB.SetMaxOpenConns(1)

	if err := db.AutoMigrate(
		&Task{},
		&User{},
		&UserSession{},
		&AuthFlow{},
		&ExternalIdentityClaim{},
		&Token{},
		&PasskeyCredential{},
		&TwoFA{},
		&TwoFABackupCode{},
		&Log{},
		&Channel{},
		&QuotaData{},
		&Ability{},
		&TopUp{},
		&SubscriptionPlan{},
		&SubscriptionOrder{},
		&UserSubscription{},
		&UserOAuthBinding{},
		&PerfMetric{},
		&SystemInstance{},
		&SystemTask{},
		&SystemTaskLock{},
	); err != nil {
		panic("failed to migrate: " + err.Error())
	}

	os.Exit(m.Run())
}

func truncateTables(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		DB.Exec("DELETE FROM tasks")
		DB.Exec("DELETE FROM auth_flows")
		DB.Exec("DELETE FROM external_identity_claims")
		DB.Exec("DELETE FROM user_sessions")
		DB.Exec("DELETE FROM passkey_credentials")
		DB.Exec("DELETE FROM two_fa_backup_codes")
		DB.Exec("DELETE FROM two_fas")
		DB.Exec("DELETE FROM tokens")
		DB.Exec("DELETE FROM user_oauth_bindings")
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM logs")
		DB.Exec("DELETE FROM channels")
		DB.Exec("DELETE FROM quota_data")
		DB.Exec("DELETE FROM abilities")
		DB.Exec("DELETE FROM top_ups")
		DB.Exec("DELETE FROM subscription_orders")
		DB.Exec("DELETE FROM subscription_plans")
		DB.Exec("DELETE FROM user_subscriptions")
		DB.Exec("DELETE FROM perf_metrics")
		DB.Exec("DELETE FROM system_instances")
		DB.Exec("DELETE FROM system_task_locks")
		DB.Exec("DELETE FROM system_tasks")
	})
}

func insertTask(t *testing.T, task *Task) {
	t.Helper()
	task.CreatedAt = time.Now().Unix()
	task.UpdatedAt = time.Now().Unix()
	require.NoError(t, DB.Create(task).Error)
}

func TestGetTaskForProtocolObservationScopesOwnerAndPlatform(t *testing.T) {
	truncateTables(t)
	task := &Task{
		TaskID:   "task_protocol_scope",
		UserId:   7,
		Platform: "plugin-a",
		Status:   TaskStatusInProgress,
	}
	insertTask(t, task)

	got, exists, err := GetTaskForProtocolObservation(context.Background(), 7, "plugin-a", task.TaskID)
	require.NoError(t, err)
	require.True(t, exists)
	assert.Equal(t, task.ID, got.ID)

	for _, query := range []struct {
		userID   int
		platform string
	}{
		{userID: 8, platform: "plugin-a"},
		{userID: 7, platform: "plugin-b"},
	} {
		got, exists, err = GetTaskForProtocolObservation(context.Background(), query.userID, constant.TaskPlatform(query.platform), task.TaskID)
		require.NoError(t, err)
		assert.False(t, exists)
		assert.Nil(t, got)
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err = GetTaskForProtocolObservation(cancelled, 7, "plugin-a", task.TaskID)
	require.ErrorIs(t, err, context.Canceled)
}

// ---------------------------------------------------------------------------
// Snapshot / Equal — pure logic tests (no DB)
// ---------------------------------------------------------------------------

func TestSnapshotEqual_Same(t *testing.T) {
	s := taskSnapshot{
		Status:     TaskStatusInProgress,
		Progress:   "50%",
		StartTime:  1000,
		FinishTime: 0,
		FailReason: "",
		ResultURL:  "",
		Data:       json.RawMessage(`{"key":"value"}`),
	}
	assert.True(t, s.Equal(s))
}

func TestSnapshotEqual_DifferentStatus(t *testing.T) {
	a := taskSnapshot{Status: TaskStatusInProgress, Data: json.RawMessage(`{}`)}
	b := taskSnapshot{Status: TaskStatusSuccess, Data: json.RawMessage(`{}`)}
	assert.False(t, a.Equal(b))
}

func TestSnapshotEqual_DifferentProgress(t *testing.T) {
	a := taskSnapshot{Status: TaskStatusInProgress, Progress: "30%", Data: json.RawMessage(`{}`)}
	b := taskSnapshot{Status: TaskStatusInProgress, Progress: "60%", Data: json.RawMessage(`{}`)}
	assert.False(t, a.Equal(b))
}

func TestSnapshotEqual_DifferentData(t *testing.T) {
	a := taskSnapshot{Status: TaskStatusInProgress, Data: json.RawMessage(`{"a":1}`)}
	b := taskSnapshot{Status: TaskStatusInProgress, Data: json.RawMessage(`{"a":2}`)}
	assert.False(t, a.Equal(b))
}

func TestSnapshotEqual_NilVsEmpty(t *testing.T) {
	a := taskSnapshot{Status: TaskStatusInProgress, Data: nil}
	b := taskSnapshot{Status: TaskStatusInProgress, Data: json.RawMessage{}}
	// bytes.Equal(nil, []byte{}) == true
	assert.True(t, a.Equal(b))
}

func TestSnapshotEqual_PluginStateAndPollFailures(t *testing.T) {
	base := taskSnapshot{
		Status:       TaskStatusInProgress,
		PluginState:  json.RawMessage(`{"req_key":"a"}`),
		PollFailures: 2,
	}
	assert.True(t, base.Equal(taskSnapshot{
		Status:       TaskStatusInProgress,
		PluginState:  json.RawMessage(`{"req_key":"a"}`),
		PollFailures: 2,
	}))
	assert.False(t, base.Equal(taskSnapshot{
		Status:       TaskStatusInProgress,
		PluginState:  json.RawMessage(`{"req_key":"b"}`),
		PollFailures: 2,
	}))
	assert.False(t, base.Equal(taskSnapshot{
		Status:       TaskStatusInProgress,
		PluginState:  json.RawMessage(`{"req_key":"a"}`),
		PollFailures: 3,
	}))
}

func TestSnapshot_Roundtrip(t *testing.T) {
	task := &Task{
		Status:     TaskStatusInProgress,
		Progress:   "42%",
		StartTime:  1234,
		FinishTime: 5678,
		FailReason: "timeout",
		PrivateData: TaskPrivateData{
			ResultURL:    "https://example.com/result.mp4",
			PluginState:  json.RawMessage(`{"req_key":"keep"}`),
			PollFailures: 3,
		},
		Data: json.RawMessage(`{"model":"test-model"}`),
	}
	snap := task.Snapshot()
	assert.Equal(t, task.Status, snap.Status)
	assert.Equal(t, task.Progress, snap.Progress)
	assert.Equal(t, task.StartTime, snap.StartTime)
	assert.Equal(t, task.FinishTime, snap.FinishTime)
	assert.Equal(t, task.FailReason, snap.FailReason)
	assert.Equal(t, task.PrivateData.ResultURL, snap.ResultURL)
	assert.JSONEq(t, string(task.Data), string(snap.Data))
	assert.Equal(t, task.PrivateData.PluginState, snap.PluginState)
	assert.Equal(t, task.PrivateData.PollFailures, snap.PollFailures)
}

// ---------------------------------------------------------------------------
// UpdateWithStatus CAS — DB integration tests
// ---------------------------------------------------------------------------

func TestUpdateWithStatus_Win(t *testing.T) {
	truncateTables(t)

	task := &Task{
		TaskID:   "task_cas_win",
		Status:   TaskStatusInProgress,
		Progress: "50%",
		Data:     json.RawMessage(`{}`),
	}
	insertTask(t, task)

	task.Status = TaskStatusSuccess
	task.Progress = "100%"
	won, err := task.UpdateWithStatus(TaskStatusInProgress)
	require.NoError(t, err)
	assert.True(t, won)

	var reloaded Task
	require.NoError(t, DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, TaskStatusSuccess, reloaded.Status)
	assert.Equal(t, "100%", reloaded.Progress)
}

func TestUpdateWithStatus_Lose(t *testing.T) {
	truncateTables(t)

	task := &Task{
		TaskID: "task_cas_lose",
		Status: TaskStatusFailure,
		Data:   json.RawMessage(`{}`),
	}
	insertTask(t, task)

	task.Status = TaskStatusSuccess
	won, err := task.UpdateWithStatus(TaskStatusInProgress) // wrong fromStatus
	require.NoError(t, err)
	assert.False(t, won)

	var reloaded Task
	require.NoError(t, DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, TaskStatusFailure, reloaded.Status) // unchanged
}

func TestUpdateWithStatus_ConcurrentWinner(t *testing.T) {
	truncateTables(t)

	task := &Task{
		TaskID: "task_cas_race",
		Status: TaskStatusInProgress,
		Quota:  1000,
		Data:   json.RawMessage(`{}`),
	}
	insertTask(t, task)

	const goroutines = 5
	wins := make([]bool, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := range goroutines {
		go func(idx int) {
			defer wg.Done()
			t := &Task{}
			*t = Task{
				ID:       task.ID,
				TaskID:   task.TaskID,
				Status:   TaskStatusSuccess,
				Progress: "100%",
				Quota:    task.Quota,
				Data:     json.RawMessage(`{}`),
			}
			t.CreatedAt = task.CreatedAt
			t.UpdatedAt = time.Now().Unix()
			won, err := t.UpdateWithStatus(TaskStatusInProgress)
			if err == nil {
				wins[idx] = won
			}
		}(i)
	}
	wg.Wait()

	winCount := 0
	for _, w := range wins {
		if w {
			winCount++
		}
	}
	assert.Equal(t, 1, winCount, "exactly one goroutine should win the CAS")
}

func TestUpdateWithStatus_PersistsPluginStateAndPollFailures(t *testing.T) {
	truncateTables(t)

	task := &Task{
		TaskID: "task_cas_plugin_state",
		Status: TaskStatusInProgress,
		Data:   json.RawMessage(`{}`),
		PrivateData: TaskPrivateData{
			PluginState:  json.RawMessage(`{"req_key":"old"}`),
			PollFailures: 1,
		},
	}
	insertTask(t, task)

	task.PrivateData.PluginState = json.RawMessage(`{"req_key":"new"}`)
	task.PrivateData.PollFailures = 4
	won, err := task.UpdateWithStatus(TaskStatusInProgress)
	require.NoError(t, err)
	require.True(t, won)

	var reloaded Task
	require.NoError(t, DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, TaskStatusInProgress, reloaded.Status)
	assert.JSONEq(t, `{"req_key":"new"}`, string(reloaded.PrivateData.PluginState))
	assert.Equal(t, 4, reloaded.PrivateData.PollFailures)
}

type superResolutionTestDatabase struct {
	name      string
	env       string
	dialect   common.DatabaseType
	dialector func(string) gorm.Dialector
}

func forEachSuperResolutionTestDatabase(t *testing.T, test func(*testing.T, *gorm.DB, common.DatabaseType)) {
	t.Helper()
	tests := []superResolutionTestDatabase{
		{
			name:      "sqlite",
			dialect:   common.DatabaseTypeSQLite,
			dialector: func(string) gorm.Dialector { return sqlite.Open(":memory:") },
		},
		{
			name:      "mysql",
			env:       "TEST_MYSQL_DSN",
			dialect:   common.DatabaseTypeMySQL,
			dialector: func(dsn string) gorm.Dialector { return mysql.Open(dsn) },
		},
		{
			name:    "postgres",
			env:     "TEST_POSTGRES_DSN",
			dialect: common.DatabaseTypePostgreSQL,
			dialector: func(dsn string) gorm.Dialector {
				return postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
			},
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			dsn := ""
			if testCase.env != "" {
				dsn = strings.TrimSpace(os.Getenv(testCase.env))
				if dsn == "" {
					t.Skip(testCase.env + " is not configured")
				}
			}

			recorder := &migrationSQLRecorder{}
			db, err := gorm.Open(testCase.dialector(dsn), &gorm.Config{
				Logger: recorder,
				NamingStrategy: schema.NamingStrategy{
					TablePrefix: fmt.Sprintf("sr_%d_", time.Now().UnixNano()),
				},
			})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if testCase.dialect == common.DatabaseTypeSQLite {
				sqlDB.SetMaxOpenConns(1)
			} else {
				sqlDB.SetMaxOpenConns(8)
			}
			t.Cleanup(func() { _ = sqlDB.Close() })

			oldDB := DB
			oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
			DB = db
			LOG_DB = db
			common.SetDatabaseTypes(testCase.dialect, testCase.dialect)
			t.Cleanup(func() {
				DB = oldDB
				LOG_DB = oldDB
				common.SetDatabaseTypes(oldMain, oldLog)
			})

			require.NoError(t, db.AutoMigrate(&Task{}))
			recorder.reset()
			require.NoError(t, db.AutoMigrate(&Task{}))
			assert.Empty(t, recorder.schemaMutations(), "second AutoMigrate must not emit schema changes")

			test(t, db, testCase.dialect)
		})
	}
}

func TestTaskSuperResolutionPrivateDataRoundTripsAcrossDatabases(t *testing.T) {
	forEachSuperResolutionTestDatabase(t, func(t *testing.T, db *gorm.DB, _ common.DatabaseType) {
		task := &Task{
			TaskID:   "task_sr_json_roundtrip",
			UserId:   42,
			Status:   TaskStatusInProgress,
			Progress: "45%",
			Data:     json.RawMessage(`{"status":"processing"}`),
			PrivateData: TaskPrivateData{
				SuperResolution: &TaskSuperResolutionState{
					Phase:            "upload_pending",
					SourceResolution: "720p",
					TargetResolution: "4k",
					PreserveOriginal: true,
					OriginalURL:      "https://provider.invalid/private/original.mp4",
					CleanupStatus:    "pending",
					UsageFacts:       map[string]any{"seconds": 12.5, "resolution": "4k"},
				},
			},
		}
		require.NoError(t, db.Create(task).Error)

		var reloaded Task
		require.NoError(t, db.First(&reloaded, task.ID).Error)
		require.NotNil(t, reloaded.PrivateData.SuperResolution)
		assert.Equal(t, "upload_pending", reloaded.PrivateData.SuperResolution.Phase)
		assert.Equal(t, "720p", reloaded.PrivateData.SuperResolution.SourceResolution)
		assert.Equal(t, "4k", reloaded.PrivateData.SuperResolution.TargetResolution)
		assert.True(t, reloaded.PrivateData.SuperResolution.PreserveOriginal)
		assert.Equal(t, "https://provider.invalid/private/original.mp4", reloaded.PrivateData.SuperResolution.OriginalURL)
		assert.Equal(t, 12.5, reloaded.PrivateData.SuperResolution.UsageFacts["seconds"])
		assert.JSONEq(t, `{"status":"processing"}`, string(reloaded.Data))
		assert.NotContains(t, string(reloaded.Data), "original.mp4")
	})
}

func TestClaimSuperResolutionUploadAllowsOnlyOneConcurrentClaimAcrossDatabases(t *testing.T) {
	forEachSuperResolutionTestDatabase(t, func(t *testing.T, db *gorm.DB, _ common.DatabaseType) {
		task := &Task{
			TaskID: "task_sr_claim",
			UserId: 42,
			Status: TaskStatusInProgress,
			PrivateData: TaskPrivateData{SuperResolution: &TaskSuperResolutionState{
				Phase: "upload_pending",
			}},
		}
		require.NoError(t, db.Create(task).Error)

		const workers = 8
		start := make(chan struct{})
		claims := make(chan bool, workers)
		errs := make(chan error, workers)
		var wg sync.WaitGroup
		wg.Add(workers)
		for range workers {
			go func() {
				defer wg.Done()
				<-start
				claimed, err := (&Task{ID: task.ID}).ClaimSuperResolutionUpload()
				claims <- claimed
				errs <- err
			}()
		}
		close(start)
		wg.Wait()
		close(claims)
		close(errs)

		claimCount := 0
		for claimed := range claims {
			if claimed {
				claimCount++
			}
		}
		for err := range errs {
			require.NoError(t, err)
		}
		assert.Equal(t, 1, claimCount, "exactly one worker may claim the external upload")

		var reloaded Task
		require.NoError(t, db.First(&reloaded, task.ID).Error)
		require.NotNil(t, reloaded.PrivateData.SuperResolution)
		assert.Equal(t, "upload_submitting", reloaded.PrivateData.SuperResolution.Phase)
	})
}

func TestGetSuperResolutionCleanupTasksSelectsPendingAndRequestedOnlyAcrossDatabases(t *testing.T) {
	forEachSuperResolutionTestDatabase(t, func(t *testing.T, db *gorm.DB, _ common.DatabaseType) {
		cases := []struct {
			taskID        string
			status        TaskStatus
			cleanupStatus string
		}{
			{taskID: "sr_cleanup_pending", status: TaskStatusSuccess, cleanupStatus: "pending"},
			{taskID: "sr_cleanup_requested", status: TaskStatusFailure, cleanupStatus: "requested"},
			{taskID: "sr_cleanup_confirmed", status: TaskStatusSuccess, cleanupStatus: "confirmed"},
			{taskID: "sr_cleanup_active", status: TaskStatusInProgress, cleanupStatus: "pending"},
		}
		for _, testCase := range cases {
			require.NoError(t, db.Create(&Task{
				TaskID: testCase.taskID,
				Status: testCase.status,
				PrivateData: TaskPrivateData{SuperResolution: &TaskSuperResolutionState{
					CleanupStatus: testCase.cleanupStatus,
				}},
			}).Error)
		}

		selected, err := GetSuperResolutionCleanupTasks(10)
		require.NoError(t, err)
		selectedIDs := make(map[string]bool, len(selected))
		for _, task := range selected {
			selectedIDs[task.TaskID] = true
		}
		assert.True(t, selectedIDs["sr_cleanup_pending"])
		assert.True(t, selectedIDs["sr_cleanup_requested"])
		assert.False(t, selectedIDs["sr_cleanup_confirmed"])
		assert.False(t, selectedIDs["sr_cleanup_active"])
	})
}

func TestHasUnfinishedSyncTasksIncludesPendingSuperResolutionCleanup(t *testing.T) {
	forEachSuperResolutionTestDatabase(t, func(t *testing.T, db *gorm.DB, _ common.DatabaseType) {
		require.NoError(t, db.Create(&Task{
			TaskID: "sr_cleanup_scheduler",
			Status: TaskStatusSuccess,
			PrivateData: TaskPrivateData{SuperResolution: &TaskSuperResolutionState{
				CleanupStatus: "pending",
			}},
		}).Error)
		assert.True(t, HasUnfinishedSyncTasks(), "cleanup work must keep the async poll scheduler active")

		require.NoError(t, db.Model(&Task{}).Where("task_id = ?", "sr_cleanup_scheduler").Update("private_data", TaskPrivateData{SuperResolution: &TaskSuperResolutionState{CleanupStatus: "confirmed"}}).Error)
		assert.False(t, HasUnfinishedSyncTasks(), "confirmed cleanup must not keep the scheduler active")
	})
}

func TestSuperResolutionPhaseCASRejectsStaleProgressAcrossDatabases(t *testing.T) {
	forEachSuperResolutionTestDatabase(t, func(t *testing.T, db *gorm.DB, _ common.DatabaseType) {
		task := &Task{TaskID: "sr_phase_cas", Status: TaskStatusInProgress, PrivateData: TaskPrivateData{SuperResolution: &TaskSuperResolutionState{Phase: "workflow_pending"}}}
		require.NoError(t, db.Create(task).Error)
		var stale Task
		require.NoError(t, db.First(&stale, task.ID).Error)
		before := *task.PrivateData.SuperResolution
		task.PrivateData.SuperResolution.Phase = "workflow_processing"
		won, err := task.UpdateSuperResolutionState(TaskStatusInProgress, before)
		require.NoError(t, err)
		require.True(t, won)
		stale.PrivateData.SuperResolution.Phase = "workflow_processing"
		stale.Progress = "10%"
		won, err = stale.UpdateSuperResolutionState(TaskStatusInProgress, before)
		require.NoError(t, err)
		assert.False(t, won)
		require.NoError(t, db.First(task, task.ID).Error)
		assert.Equal(t, "workflow_processing", task.PrivateData.SuperResolution.Phase)
		assert.NotEqual(t, "10%", task.Progress)
		before = *task.PrivateData.SuperResolution
		task.Status = TaskStatusSuccess
		task.PrivateData.SuperResolution.Phase = "complete"
		task.PrivateData.SuperResolution.CleanupStatus = "requested"
		won, err = task.UpdateSuperResolutionState(TaskStatusInProgress, before)
		require.NoError(t, err)
		require.True(t, won)
		require.NoError(t, db.First(&stale, task.ID).Error)
		before = *task.PrivateData.SuperResolution
		task.PrivateData.SuperResolution.CleanupStatus = "confirmed"
		won, err = task.UpdateSuperResolutionState(TaskStatusSuccess, before)
		require.NoError(t, err)
		require.True(t, won)
		won, err = stale.UpdateSuperResolutionState(TaskStatusSuccess, before)
		require.NoError(t, err)
		assert.False(t, won)
	})
}
