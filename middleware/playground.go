package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// PlaygroundSessionOnly keeps browser-only Playground helpers from accepting
// dashboard personal access tokens. The main Playground relay uses the same
// restriction while building its temporary token context.
func PlaygroundSessionOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetBool("use_access_token") {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"success": false,
				"code":    "PLAYGROUND_SESSION_REQUIRED",
				"message": "dashboard session required",
			})
			return
		}
		c.Next()
	}
}

// PlaygroundVideoAuth converts an authenticated dashboard user into the
// temporary token context expected by the shared video relay pipeline.
func PlaygroundVideoAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetBool("use_access_token") {
			abortWithOpenAiMessage(c, http.StatusForbidden, "暂不支持使用 access token")
			return
		}

		userID := c.GetInt("id")
		userGroup := c.GetString("group")
		usingGroup := strings.TrimSpace(c.Query("group"))
		if usingGroup == "" {
			usingGroup = userGroup
		}
		if usingGroup != userGroup && !service.GroupInUserUsableGroups(userGroup, usingGroup) {
			abortWithOpenAiMessage(c, http.StatusForbidden, i18n.T(c, i18n.MsgDistributorGroupAccessDenied))
			return
		}

		common.SetContextKey(c, constant.ContextKeyIsPlayground, true)
		common.SetContextKey(c, constant.ContextKeyUsingGroup, usingGroup)
		tempToken := &model.Token{
			UserId: userID,
			Name:   fmt.Sprintf("playground-%s", usingGroup),
			Group:  usingGroup,
		}
		if err := SetupContextForToken(c, tempToken); err != nil {
			abortWithOpenAiMessage(c, http.StatusInternalServerError, err.Error())
			return
		}
		c.Next()
	}
}

// RewritePlaygroundVideoPath lets the existing video relay and plugin pipeline
// treat the dashboard-only /pg surface exactly like its /v1 counterpart.
func RewritePlaygroundVideoPath() gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/pg/videos") {
			c.Request.URL.Path = "/v1" + strings.TrimPrefix(c.Request.URL.Path, "/pg")
			c.Request.RequestURI = c.Request.URL.RequestURI()
		}
		c.Next()
	}
}
