package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const VideoSuperResolutionOptionKeyPrefix = "VideoSuperResolution:"

const videoSuperResolutionContextKey = "video_super_resolution.snapshot"

var (
	ErrVideoSuperResolutionUnsupportedModel = errors.New("video super-resolution supports Seedance 2.0 models only")
	ErrVideoSuperResolutionNotConfigured    = errors.New("video super-resolution is not configured")
)

type VideoSuperResolutionConfig struct {
	Enabled          bool   `json:"enabled"`
	SourceResolution string `json:"source_resolution"`
	PreserveOriginal bool   `json:"preserve_original"`
}

type VideoSuperResolutionSnapshot struct {
	SourceResolution string `json:"source_resolution"`
	TargetResolution string `json:"target_resolution"`
	PreserveOriginal bool   `json:"preserve_original"`
}

type VideoSuperResolutionRuntimeConfig struct {
	AccessKey       string
	SecretKey       string
	SpaceName       string
	Region          string
	WorkflowID      string
	StoragePath     string
	StorageBasePath string
}

func DefaultVideoSuperResolutionConfig() VideoSuperResolutionConfig {
	return VideoSuperResolutionConfig{
		SourceResolution: "720p",
		PreserveOriginal: true,
	}
}

func normalizeVideoSuperResolutionModel(modelName string) string {
	return strings.TrimSpace(modelName)
}

func isSeedance20Model(modelName string) bool {
	switch strings.ToLower(normalizeVideoSuperResolutionModel(modelName)) {
	case "doubao-seedance-2-0-260128",
		"doubao-seedance-2-0-fast-260128",
		"dreamina-seedance-2-0-260128",
		"dreamina-seedance-2-0-fast-260128",
		"doubao-seedance-2.0",
		"doubao-seedance-2.0-fast",
		"dreamina-seedance-2.0",
		"dreamina-seedance-2.0-fast":
		return true
	default:
		return false
	}
}

func IsVideoSuperResolutionModel(modelName string) bool {
	return isSeedance20Model(modelName)
}

func GetVideoSuperResolutionConfig(modelName string) VideoSuperResolutionConfig {
	config, ok := lookupVideoSuperResolutionConfig(modelName)
	if !ok {
		return DefaultVideoSuperResolutionConfig()
	}
	return config
}

func lookupVideoSuperResolutionConfig(modelName string) (VideoSuperResolutionConfig, bool) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return VideoSuperResolutionConfig{}, false
	}
	common.OptionMapRWMutex.RLock()
	raw, ok := common.OptionMap[VideoSuperResolutionOptionKeyPrefix+modelName]
	common.OptionMapRWMutex.RUnlock()
	if !ok || strings.TrimSpace(raw) == "" {
		return VideoSuperResolutionConfig{}, false
	}
	var config VideoSuperResolutionConfig
	if common.UnmarshalJsonStr(raw, &config) != nil {
		return VideoSuperResolutionConfig{}, false
	}
	return normalizeVideoSuperResolutionConfig(config), true
}

func normalizeVideoSuperResolutionConfig(config VideoSuperResolutionConfig) VideoSuperResolutionConfig {
	if config.SourceResolution != "480p" && config.SourceResolution != "720p" {
		config.SourceResolution = "720p"
	}
	return config
}

func SaveVideoSuperResolutionConfig(modelName string, config VideoSuperResolutionConfig) error {
	modelName = normalizeVideoSuperResolutionModel(modelName)
	if modelName == "" || len(modelName) > 128 || strings.ContainsAny(modelName, "\r\n\x00") {
		return errors.New("model_name is required")
	}
	if config.SourceResolution != "480p" && config.SourceResolution != "720p" {
		return errors.New("source_resolution must be 480p or 720p")
	}
	config = normalizeVideoSuperResolutionConfig(config)
	encoded, err := common.Marshal(config)
	if err != nil {
		return err
	}
	return model.UpdateOption(VideoSuperResolutionOptionKeyPrefix+modelName, string(encoded))
}

func targetResolution(value any) string {
	raw := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	if raw == "4k" || raw == "2160p" {
		return "4k"
	}
	if raw == "1080p" {
		return "1080p"
	}
	if raw == "720p" {
		return "720p"
	}
	if raw == "480p" {
		return "480p"
	}
	parts := strings.Split(strings.ReplaceAll(raw, "*", "x"), "x")
	if len(parts) == 2 {
		var width, height int
		if _, err := fmt.Sscan(parts[0], &width); err == nil {
			if _, err := fmt.Sscan(parts[1], &height); err == nil {
				maxDimension := width
				if height > maxDimension {
					maxDimension = height
				}
				switch {
				case maxDimension >= 3840:
					return "4k"
				case maxDimension >= 1920:
					return "1080p"
				case maxDimension >= 1280:
					return "720p"
				}
			}
		}
	}
	return "480p"
}

func resolutionNeedsSuperResolution(resolution string) bool {
	return resolution == "1080p" || resolution == "4k"
}

func ApplyVideoSuperResolution(c *gin.Context, pluginKey, originModelName, upstreamModelName string, descriptorBody any) error {
	c.Set(videoSuperResolutionContextKey, nil)
	c.Set(videoSuperResolutionRuntimeContextKey, nil)
	config, configured := lookupVideoSuperResolutionConfig(originModelName)
	if !configured || !config.Enabled {
		return nil
	}
	if pluginKey != "doubao" {
		return ErrVideoSuperResolutionUnsupportedModel
	}
	body, ok := descriptorBody.(map[string]any)
	if !ok {
		return errors.New("video super-resolution requires a JSON submit body")
	}
	rawResolution, exists := body["resolution"]
	if !exists {
		rawResolution = body["size"]
	}
	resolution := targetResolution(rawResolution)
	if !resolutionNeedsSuperResolution(resolution) {
		return nil
	}
	bodyModelName, _ := body["model"].(string)
	if !isSeedance20Model(firstString(bodyModelName, upstreamModelName, originModelName)) {
		return ErrVideoSuperResolutionUnsupportedModel
	}
	config = normalizeVideoSuperResolutionConfig(config)
	runtime, err := videoSuperResolutionRuntimeConfig(resolution)
	if err != nil {
		return err
	}
	if runtime.WorkflowID == "" {
		return ErrVideoSuperResolutionNotConfigured
	}
	body["resolution"] = config.SourceResolution
	c.Set(videoSuperResolutionContextKey, VideoSuperResolutionSnapshot{
		SourceResolution: config.SourceResolution,
		TargetResolution: resolution,
		PreserveOriginal: config.PreserveOriginal,
	})
	c.Set(videoSuperResolutionRuntimeContextKey, runtime)
	return nil
}

func GetVideoSuperResolutionSnapshot(c *gin.Context) (VideoSuperResolutionSnapshot, bool) {
	if c == nil {
		return VideoSuperResolutionSnapshot{}, false
	}
	value, ok := c.Get(videoSuperResolutionContextKey)
	snapshot, valid := value.(VideoSuperResolutionSnapshot)
	return snapshot, ok && valid
}

const videoSuperResolutionRuntimeContextKey = "video_super_resolution.runtime"

func GetVideoSuperResolutionRuntimeConfig(c *gin.Context) (VideoSuperResolutionRuntimeConfig, bool) {
	if c == nil {
		return VideoSuperResolutionRuntimeConfig{}, false
	}
	value, ok := c.Get(videoSuperResolutionRuntimeContextKey)
	runtime, valid := value.(VideoSuperResolutionRuntimeConfig)
	return runtime, ok && valid
}

func videoSuperResolutionRuntimeConfig(target string) (VideoSuperResolutionRuntimeConfig, error) {
	runtime := VideoSuperResolutionRuntimeConfig{
		AccessKey:   strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_ACCESS_KEY")),
		SecretKey:   strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_SECRET_KEY")),
		SpaceName:   strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_SPACE")),
		Region:      "ap-southeast-1",
		StoragePath: strings.TrimSpace(os.Getenv("VIDEO_SR_STORAGE_PATH")),
	}
	if target == "4k" {
		runtime.WorkflowID = strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_SR_WORKFLOW_4K"))
	} else {
		runtime.WorkflowID = strings.TrimSpace(os.Getenv("BYTEPLUS_VOD_SR_WORKFLOW_1080P"))
	}
	if runtime.AccessKey == "" || runtime.SecretKey == "" || runtime.SpaceName == "" || runtime.StoragePath == "" {
		return VideoSuperResolutionRuntimeConfig{}, ErrVideoSuperResolutionNotConfigured
	}
	info, err := os.Stat(runtime.StoragePath)
	if err != nil || !info.IsDir() {
		return VideoSuperResolutionRuntimeConfig{}, fmt.Errorf("video super-resolution storage path is unavailable")
	}
	if err := ensureWritableDirectory(runtime.StoragePath); err != nil {
		return VideoSuperResolutionRuntimeConfig{}, fmt.Errorf("video super-resolution storage path is not writable: %w", err)
	}
	runtime.StorageBasePath, err = filepath.Abs(runtime.StoragePath)
	if err != nil {
		return VideoSuperResolutionRuntimeConfig{}, err
	}
	return runtime, nil
}

func ensureWritableDirectory(path string) error {
	testFile, err := os.CreateTemp(path, ".video-sr-check-*")
	if err != nil {
		return err
	}
	testName := testFile.Name()
	if err := testFile.Close(); err != nil {
		_ = os.Remove(testName)
		return err
	}
	return os.Remove(testName)
}

// ClearVideoSuperResolutionSnapshot 防止渠道重试复用上次尝试的内部路由。
func ClearVideoSuperResolutionSnapshot(c *gin.Context) {
	c.Set(videoSuperResolutionContextKey, nil)
	c.Set(videoSuperResolutionRuntimeContextKey, nil)
}
