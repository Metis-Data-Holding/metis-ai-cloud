package router

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestLogExportRoutesRateLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousTypes := [2]common.DatabaseType{common.MainDatabaseType(), common.LogDatabaseType()}
	previousRedis, previousMemory := common.RedisEnabled, common.MemoryCacheEnabled
	previousGlobal, previousCritical := common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable
	previousCriticalNum, previousCriticalDuration := common.CriticalRateLimitNum, common.CriticalRateLimitDuration
	previousSecret, previousMaster := common.SessionSecret, common.IsMasterNode
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousTypes[0], previousTypes[1])
		common.RedisEnabled, common.MemoryCacheEnabled = previousRedis, previousMemory
		common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable = previousGlobal, previousCritical
		common.CriticalRateLimitNum, common.CriticalRateLimitDuration = previousCriticalNum, previousCriticalDuration
		common.SessionSecret, common.IsMasterNode = previousSecret, previousMaster
	})

	mainDB := openLogExportRateLimitTestDB(t, filepath.Join(t.TempDir(), "main.db"))
	logDB := openLogExportRateLimitTestDB(t, filepath.Join(t.TempDir(), "log.db"))
	require.NoError(t, mainDB.AutoMigrate(&model.User{}, &model.UserSession{}, &model.AuditLog{}, &model.Option{}))
	require.NoError(t, logDB.AutoMigrate(&model.Log{}))
	model.DB, model.LOG_DB = mainDB, logDB
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled, common.MemoryCacheEnabled = false, false
	common.GlobalApiRateLimitEnable, common.CriticalRateLimitEnable = false, true
	common.CriticalRateLimitNum, common.CriticalRateLimitDuration = 1, 60
	common.SessionSecret, common.IsMasterNode = "log-export-rate-limit-test-secret", true

	admin := createLogExportRateLimitTestUser(t, 701001, common.RoleAdminUser, "admin")
	user := createLogExportRateLimitTestUser(t, 701002, common.RoleCommonUser, "user")
	adminSession, err := service.CreateLoginSession(admin.Id, "password", "198.18.0.1", "rate-limit-test")
	require.NoError(t, err)
	userSession, err := service.CreateLoginSession(user.Id, "password", "198.18.0.2", "rate-limit-test")
	require.NoError(t, err)

	engine := gin.New()
	SetApiRouter(engine)
	query := fmt.Sprintf("?start_timestamp=%d&end_timestamp=%d", time.Now().Unix()-60, time.Now().Unix())

	adminFirst := performLogExportRateLimitRequest(engine, "/api/log/export"+query, adminSession.AccessToken, "198.18.0.3")
	require.Equal(t, http.StatusOK, adminFirst.Code, adminFirst.Body.String())
	adminSecond := performLogExportRateLimitRequest(engine, "/api/log/export"+query, adminSession.AccessToken, "198.18.0.3")
	require.Equal(t, http.StatusTooManyRequests, adminSecond.Code)

	userFirst := performLogExportRateLimitRequest(engine, "/api/log/self/export"+query, userSession.AccessToken, "198.18.0.4")
	require.Equal(t, http.StatusOK, userFirst.Code, userFirst.Body.String())
	userSecond := performLogExportRateLimitRequest(engine, "/api/log/self/export"+query, userSession.AccessToken, "198.18.0.5")
	require.Equal(t, http.StatusTooManyRequests, userSecond.Code)
}

func openLogExportRateLimitTestDB(t *testing.T, path string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	require.NoError(t, err)
	return db
}

func createLogExportRateLimitTestUser(t *testing.T, id, role int, suffix string) *model.User {
	t.Helper()
	user := &model.User{
		Id: id, Username: "log-export-rate-limit-" + suffix, Password: "password-placeholder",
		Role: role, Status: common.UserStatusEnabled, Group: "default", AffCode: "log-export-rate-limit-" + suffix,
		AuthVersion: 1,
	}
	require.NoError(t, model.DB.Create(user).Error)
	return user
}

func performLogExportRateLimitRequest(engine *gin.Engine, path, token, ip string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.RemoteAddr = ip + ":1234"
	request.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	return recorder
}
