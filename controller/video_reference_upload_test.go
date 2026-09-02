package controller

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUploadVideoReferenceReturnsSignedContentURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	t.Setenv("VIDEO_REFERENCE_UPLOAD_DIR", dir)
	previousSecret := common.CryptoSecret
	previousAddress := system_setting.ServerAddress
	previousPublicAddress := system_setting.TaskPublicAddress
	common.CryptoSecret = "controller-video-reference-secret"
	system_setting.ServerAddress = "https://many-models.example"
	system_setting.TaskPublicAddress = ""
	t.Cleanup(func() {
		common.CryptoSecret = previousSecret
		system_setting.ServerAddress = previousAddress
		system_setting.TaskPublicAddress = previousPublicAddress
	})

	body := bytes.NewBuffer(nil)
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "motion.mp4")
	require.NoError(t, err)
	_, err = part.Write(append([]byte{0, 0, 0, 24}, []byte("ftypisom00000000")...))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/playground/video-reference-files", body)
	context.Request.Header.Set("Content-Type", writer.FormDataContentType())

	UploadVideoReference(context)

	assert.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool                         `json:"success"`
		Data    service.VideoReferenceUpload `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.Equal(t, "motion.mp4", response.Data.Name)
	assert.Contains(t, response.Data.URL, "https://many-models.example/v1/video-reference-files/")
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Equal(t, response.Data.ID, entries[0].Name())
}

func TestGetVideoReferenceContentSupportsRangeAndRejectsExpiredAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	t.Setenv("VIDEO_REFERENCE_UPLOAD_DIR", dir)
	previousSecret := common.CryptoSecret
	common.CryptoSecret = "controller-video-reference-secret"
	t.Cleanup(func() { common.CryptoSecret = previousSecret })

	fileID := "abcdefghijklmnopqrstuvwx.mp4"
	data := []byte("0123456789")
	require.NoError(t, os.WriteFile(filepath.Join(dir, fileID), data, 0o600))
	expires := time.Now().Add(time.Hour).Unix()
	access, err := service.IssueVideoReferenceAccess(fileID, time.Unix(expires, 0))
	require.NoError(t, err)

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Params = gin.Params{{Key: "file_id", Value: fileID}}
	query := url.Values{}
	query.Set("expires", strconv.FormatInt(expires, 10))
	query.Set("access", access)
	context.Request = httptest.NewRequest(http.MethodGet, "/v1/video-reference-files/"+fileID+"/content?"+query.Encode(), nil)
	context.Request.Header.Set("Range", "bytes=2-5")

	GetVideoReferenceContent(context)

	assert.Equal(t, http.StatusPartialContent, recorder.Code)
	assert.Equal(t, "2345", recorder.Body.String())
	assert.Equal(t, "bytes 2-5/10", recorder.Header().Get("Content-Range"))
	assert.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))

	expiredRecorder := httptest.NewRecorder()
	expiredContext, _ := gin.CreateTestContext(expiredRecorder)
	expiredContext.Params = context.Params
	expiredContext.Request = httptest.NewRequest(http.MethodGet, "/v1/video-reference-files/"+fileID+"/content?expires=1&access="+url.QueryEscape(access), nil)
	GetVideoReferenceContent(expiredContext)
	assert.Equal(t, http.StatusForbidden, expiredRecorder.Code)
}
