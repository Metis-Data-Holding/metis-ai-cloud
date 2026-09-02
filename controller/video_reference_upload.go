package controller

import (
	"errors"
	"io"
	"io/fs"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const videoReferenceMultipartOverhead = int64(1 * 1024 * 1024)

func writeVideoReferenceUploadError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{
		"success": false,
		"code":    code,
		"message": message,
	})
}

func UploadVideoReference(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.VideoReferenceMaxBytes+videoReferenceMultipartOverhead)
	reader, err := c.Request.MultipartReader()
	if err != nil {
		writeVideoReferenceUploadError(c, http.StatusBadRequest, "invalid_video_reference_upload", "invalid multipart upload")
		return
	}

	for {
		part, nextErr := reader.NextPart()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			writeVideoReferenceUploadError(c, http.StatusBadRequest, "invalid_video_reference_upload", "unable to read multipart upload")
			return
		}
		if part.FormName() != "file" || part.FileName() == "" {
			_ = part.Close()
			continue
		}
		result, saveErr := service.SaveVideoReference(part, part.FileName(), 0, service.VideoReferenceSaveOptions{})
		_ = part.Close()
		if saveErr != nil {
			switch {
			case errors.Is(saveErr, service.ErrVideoReferenceTooLarge):
				writeVideoReferenceUploadError(c, http.StatusRequestEntityTooLarge, "video_reference_too_large", "video reference must not exceed 80 MB")
			case errors.Is(saveErr, service.ErrVideoReferenceUnsupported):
				writeVideoReferenceUploadError(c, http.StatusBadRequest, "video_reference_unsupported", "video reference must be an MP4 or MOV file")
			default:
				writeVideoReferenceUploadError(c, http.StatusInternalServerError, "video_reference_upload_failed", "unable to store video reference")
			}
			return
		}
		common.ApiSuccess(c, result)
		return
	}

	writeVideoReferenceUploadError(c, http.StatusBadRequest, "video_reference_file_required", "video reference file is required")
}

func GetVideoReferenceContent(c *gin.Context) {
	fileID := c.Param("file_id")
	expires, err := service.ParseVideoReferenceExpiry(c.Query("expires"))
	if err != nil || !service.VerifyVideoReferenceAccess(c.Query("access"), fileID, expires, time.Now()) {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	file, contentType, err := service.OpenVideoReference(service.VideoReferenceUploadDirectory(), fileID)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	c.Header("Content-Type", contentType)
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	http.ServeContent(c.Writer, c.Request, fileID, info.ModTime(), file)
}
