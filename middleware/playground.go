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

// PlaygroundTaskAuth converts an authenticated dashboard user into the
// temporary token context expected by the shared task relay pipeline.
func PlaygroundTaskAuth() gin.HandlerFunc {
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

// PlaygroundImageSubmitOnly 将浏览器提交范围限制到首期生图模型。
func PlaygroundImageSubmitOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		var request struct {
			Model string `json:"model"`
		}
		if c.Param("key") != "qwen-image-21" || common.UnmarshalBodyReusable(c, &request) != nil || request.Model != "qwen-image-2.1" {
			abortWithOpenAiMessage(c, http.StatusBadRequest, "Unsupported Playground image model")
			return
		}
		c.Next()
	}
}

// PlaygroundTaskOwnerOnly 防止临时 token 继承管理端跨用户制品读取权限。
func PlaygroundTaskOwnerOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		_, exists, err := model.GetByTaskId(c.GetInt("id"), c.Param("key"))
		if err != nil {
			abortWithOpenAiMessage(c, http.StatusInternalServerError, "Failed to query task")
			return
		}
		if !exists {
			abortWithOpenAiMessage(c, http.StatusNotFound, "Task not found")
			return
		}
		c.Next()
	}
}
