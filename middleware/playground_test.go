package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	appI18n "github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlaygroundTaskAuthCreatesTemporaryTokenContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	router := gin.New()
	reached := false
	router.POST("/pg/videos", func(c *gin.Context) {
		c.Set("id", 42)
		c.Set("group", "default")
	}, PlaygroundTaskAuth(), func(c *gin.Context) {
		reached = true
		assert.Equal(t, 42, c.GetInt("id"))
		assert.Equal(t, "playground-default", c.GetString("token_name"))
		assert.False(t, common.GetContextKeyBool(c, constant.ContextKeyTokenModelLimitEnabled))
		assert.Equal(t, "default", common.GetContextKeyString(c, constant.ContextKeyUsingGroup))
	})
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/pg/videos?group=default", nil))

	require.True(t, reached)
}

func TestPlaygroundVideoRelayInfoRemainsPlaygroundAfterPathRewrite(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	router := gin.New()
	router.POST("/pg/videos", func(c *gin.Context) {
		c.Set("id", 42)
		c.Set("group", "default")
	}, PlaygroundTaskAuth(), RewritePlaygroundVideoPath(), func(c *gin.Context) {
		info, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
		require.NoError(t, err)
		assert.True(t, info.IsPlayground)
		assert.Equal(t, "/v1/videos?group=default", info.RequestURLPath)
	})

	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/pg/videos?group=default", nil))
}

func TestPlaygroundTaskAuthRejectsDashboardAccessToken(t *testing.T) {
	recorder := httptest.NewRecorder()
	router := gin.New()
	router.POST("/pg/videos", func(c *gin.Context) {
		c.Set("id", 42)
		c.Set("group", "default")
		c.Set("use_access_token", true)
	}, PlaygroundTaskAuth())
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/pg/videos", nil))

	assert.Equal(t, http.StatusForbidden, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "access token")
}

func TestPlaygroundSessionOnlyRejectsDashboardAccessToken(t *testing.T) {
	recorder := httptest.NewRecorder()
	router := gin.New()
	reached := false
	router.POST("/api/playground/video-reference-files", func(c *gin.Context) {
		c.Set("use_access_token", true)
	}, PlaygroundSessionOnly(), func(*gin.Context) {
		reached = true
	})
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/playground/video-reference-files", nil))

	assert.Equal(t, http.StatusForbidden, recorder.Code)
	assert.False(t, reached)
}

func TestPlaygroundTaskAuthRejectsUnavailableGroup(t *testing.T) {
	require.NoError(t, appI18n.Init())
	original := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() { require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(original)) })
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"默认分组"}`))

	recorder := httptest.NewRecorder()
	router := gin.New()
	router.POST("/pg/videos", func(c *gin.Context) {
		c.Set("id", 42)
		c.Set("group", "default")
	}, PlaygroundTaskAuth())
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/pg/videos?group=vip", nil))

	assert.Equal(t, http.StatusForbidden, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "group")
}

func TestPlaygroundImageSubmitRestrictsPluginAndModel(t *testing.T) {
	for _, body := range []string{`{"model":"other"}`, `{"model":"qwen-image-2.1"}`} {
		for _, plugin := range []string{"qwen-image-21", "other"} {
			router := gin.New()
			router.POST("/pg/tasks/:key", PlaygroundImageSubmitOnly(), func(c *gin.Context) { c.Status(http.StatusNoContent) })
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/pg/tasks/"+plugin, strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			router.ServeHTTP(response, request)
			expected := http.StatusBadRequest
			if plugin == "qwen-image-21" && body == `{"model":"qwen-image-2.1"}` {
				expected = http.StatusNoContent
			}
			assert.Equal(t, expected, response.Code)
		}
	}
}

func TestPlaygroundTaskOwnerOnlyRejectsOtherUsersEvenForAdmins(t *testing.T) {
	setupOriginTaskDB(t)
	require.NoError(t, model.DB.Create(&model.Task{TaskID: "image-owned", UserId: 42}).Error)
	for _, role := range []int{common.RoleCommonUser, common.RoleAdminUser, common.RoleRootUser} {
		for _, userID := range []int{42, 43} {
			router := gin.New()
			router.GET("/pg/tasks/:key/artifacts/image/content", func(c *gin.Context) { c.Set("id", userID); c.Set("role", role) }, PlaygroundTaskOwnerOnly(), func(c *gin.Context) { c.Status(http.StatusNoContent) })
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/pg/tasks/image-owned/artifacts/image/content", nil))
			expected := http.StatusNotFound
			if userID == 42 {
				expected = http.StatusNoContent
			}
			assert.Equal(t, expected, response.Code)
		}
	}
}
