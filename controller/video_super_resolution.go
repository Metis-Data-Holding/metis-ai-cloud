package controller

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetVideoSuperResolutionConfig(c *gin.Context) {
	modelName := strings.TrimSpace(c.Query("model"))
	if modelName == "" {
		common.ApiErrorMsg(c, "model is required")
		return
	}
	config := service.GetVideoSuperResolutionConfig(modelName)
	common.ApiSuccess(c, gin.H{
		"supported":                    service.IsVideoSuperResolutionModel(modelName),
		"enabled":                      config.Enabled,
		"source_resolution":            config.SourceResolution,
		"source_resolutions":           config.SourceResolutions,
		"supported_target_resolutions": service.VideoSuperResolutionTargets(modelName),
		"preserve_original":            config.PreserveOriginal,
	})
}

func UpdateVideoSuperResolutionConfig(c *gin.Context) {
	var request struct {
		ModelName         string            `json:"model"`
		Enabled           bool              `json:"enabled"`
		SourceResolution  string            `json:"source_resolution"`
		SourceResolutions map[string]string `json:"source_resolutions"`
		PreserveOriginal  bool              `json:"preserve_original"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	if !service.IsVideoSuperResolutionModel(request.ModelName) {
		common.ApiErrorMsg(c, "该模型暂不支持超分")
		return
	}
	if err := service.SaveVideoSuperResolutionConfig(request.ModelName, service.VideoSuperResolutionConfig{
		Enabled: request.Enabled, SourceResolution: request.SourceResolution, SourceResolutions: request.SourceResolutions, PreserveOriginal: request.PreserveOriginal,
	}); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "video.super_resolution.update", map[string]any{
		"model":   strings.TrimSpace(request.ModelName),
		"enabled": request.Enabled,
	})
	common.ApiSuccess(c, gin.H{
		"supported":                    true,
		"enabled":                      request.Enabled,
		"source_resolution":            request.SourceResolution,
		"source_resolutions":           service.GetVideoSuperResolutionConfig(request.ModelName).SourceResolutions,
		"supported_target_resolutions": service.VideoSuperResolutionTargets(request.ModelName),
		"preserve_original":            request.PreserveOriginal,
	})
}

// GetVideoSuperResolutionOriginal 仅接受后台管理员会话，API Token 与 PAT 不能下载原片。
func GetVideoSuperResolutionOriginal(c *gin.Context) {
	if _, ok := middleware.GetSessionAuthIdentity(c); !ok || c.GetInt("role") < common.RoleAdminUser {
		writeTaskArtifactError(c, http.StatusForbidden, "original_forbidden", "仅管理员后台会话可下载原片")
		return
	}
	task, exists, err := model.GetUniqueByOnlyTaskId(c.Param("task_id"))
	if err != nil || !exists || task == nil {
		writeTaskArtifactError(c, http.StatusNotFound, "artifact_not_found", "原片不可用")
		return
	}
	serveVideoSuperResolutionFile(c, task, true)
}

func serveVideoSuperResolutionFile(c *gin.Context, task *model.Task, original bool) {
	file, err := service.OpenVideoSuperResolutionFile(task, original)
	if err != nil {
		writeTaskArtifactError(c, http.StatusNotFound, "artifact_not_found", "视频文件不可用")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeTaskArtifactError(c, http.StatusNotFound, "artifact_not_found", "视频文件不可用")
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Type", "video/mp4")
	c.Header("X-Content-Type-Options", "nosniff")
	if original {
		c.Header("Content-Disposition", `attachment; filename="original.mp4"`)
	}
	http.ServeContent(c.Writer, c.Request, "video.mp4", info.ModTime(), file)
}
