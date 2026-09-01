package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	appI18n "github.com/QuantumNous/new-api/i18n"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlaygroundVideoAuthCreatesTemporaryTokenContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	router := gin.New()
	reached := false
	router.POST("/pg/videos", func(c *gin.Context) {
		c.Set("id", 42)
		c.Set("group", "default")
	}, PlaygroundVideoAuth(), func(c *gin.Context) {
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
	}, PlaygroundVideoAuth(), RewritePlaygroundVideoPath(), func(c *gin.Context) {
		info, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
		require.NoError(t, err)
		assert.True(t, info.IsPlayground)
		assert.Equal(t, "/v1/videos?group=default", info.RequestURLPath)
	})

	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/pg/videos?group=default", nil))
}

func TestPlaygroundVideoAuthRejectsDashboardAccessToken(t *testing.T) {
	recorder := httptest.NewRecorder()
	router := gin.New()
	router.POST("/pg/videos", func(c *gin.Context) {
		c.Set("id", 42)
		c.Set("group", "default")
		c.Set("use_access_token", true)
	}, PlaygroundVideoAuth())
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/pg/videos", nil))

	assert.Equal(t, http.StatusForbidden, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "access token")
}

func TestPlaygroundVideoAuthRejectsUnavailableGroup(t *testing.T) {
	require.NoError(t, appI18n.Init())
	original := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() { require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(original)) })
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"默认分组"}`))

	recorder := httptest.NewRecorder()
	router := gin.New()
	router.POST("/pg/videos", func(c *gin.Context) {
		c.Set("id", 42)
		c.Set("group", "default")
	}, PlaygroundVideoAuth())
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/pg/videos?group=vip", nil))

	assert.Equal(t, http.StatusForbidden, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "group")
}
