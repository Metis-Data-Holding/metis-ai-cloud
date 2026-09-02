package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

const (
	DefaultVideoReferenceUploadDirectory = "/data/video-reference-uploads"
	VideoReferenceMaxBytes               = int64(80 * 1024 * 1024)
	VideoReferenceTTL                    = 50 * time.Hour
	VideoReferenceUploadingTTL           = time.Hour
	videoReferenceIDLength               = 24
	videoReferenceAccessVersion          = "v1"
)

var (
	ErrVideoReferenceTooLarge      = errors.New("video reference is too large")
	ErrVideoReferenceUnsupported   = errors.New("video reference format is unsupported")
	ErrVideoReferenceInvalid       = errors.New("video reference is invalid")
	videoReferenceFilePattern      = regexp.MustCompile(`^[0-9A-Za-z]{24}\.(mp4|mov)$`)
	videoReferenceUploadingPattern = regexp.MustCompile(`^[0-9A-Za-z]{24}\.(mp4|mov)\.uploading$`)
)

type VideoReferenceSaveOptions struct {
	Directory string
	Now       time.Time
	NewID     func() (string, error)
	MaxBytes  int64
}

type VideoReferenceUpload struct {
	ID          string `json:"id"`
	URL         string `json:"url"`
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
}

type VideoReferenceCleanupResult struct {
	Scanned    int   `json:"scanned"`
	Deleted    int   `json:"deleted"`
	FreedBytes int64 `json:"freed_bytes"`
	Failed     int   `json:"failed"`
}

func VideoReferenceUploadDirectory() string {
	return common.GetEnvOrDefaultString("VIDEO_REFERENCE_UPLOAD_DIR", DefaultVideoReferenceUploadDirectory)
}

func normalizeVideoReferenceSaveOptions(options VideoReferenceSaveOptions) VideoReferenceSaveOptions {
	if strings.TrimSpace(options.Directory) == "" {
		options.Directory = VideoReferenceUploadDirectory()
	}
	if options.Now.IsZero() {
		options.Now = time.Now()
	}
	if options.NewID == nil {
		options.NewID = func() (string, error) { return common.GenerateRandomCharsKey(videoReferenceIDLength) }
	}
	if options.MaxBytes <= 0 {
		options.MaxBytes = VideoReferenceMaxBytes
	}
	return options
}

func videoReferenceFormat(name string, header []byte) (string, string, error) {
	extension := strings.ToLower(filepath.Ext(strings.TrimSpace(name)))
	if extension != ".mp4" && extension != ".mov" {
		return "", "", ErrVideoReferenceUnsupported
	}
	if len(header) < 8 || string(header[4:8]) != "ftyp" {
		return "", "", ErrVideoReferenceUnsupported
	}
	if extension == ".mov" {
		return extension, "video/quicktime", nil
	}
	return extension, "video/mp4", nil
}

func SaveVideoReference(reader io.Reader, originalName string, declaredSize int64, options VideoReferenceSaveOptions) (VideoReferenceUpload, error) {
	options = normalizeVideoReferenceSaveOptions(options)
	if reader == nil || declaredSize > options.MaxBytes {
		return VideoReferenceUpload{}, ErrVideoReferenceTooLarge
	}
	if err := os.MkdirAll(options.Directory, 0o700); err != nil {
		return VideoReferenceUpload{}, err
	}
	id, err := options.NewID()
	if err != nil || !regexp.MustCompile(`^[0-9A-Za-z]{24}$`).MatchString(id) {
		return VideoReferenceUpload{}, ErrVideoReferenceInvalid
	}
	extension := strings.ToLower(filepath.Ext(strings.TrimSpace(originalName)))
	if extension != ".mp4" && extension != ".mov" {
		return VideoReferenceUpload{}, ErrVideoReferenceUnsupported
	}
	fileID := id + extension
	temporaryPath := filepath.Join(options.Directory, fileID+".uploading")
	finalPath := filepath.Join(options.Directory, fileID)
	file, err := os.OpenFile(temporaryPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return VideoReferenceUpload{}, err
	}
	keep := false
	defer func() {
		_ = file.Close()
		if !keep {
			_ = os.Remove(temporaryPath)
		}
	}()

	written, copyErr := io.Copy(file, io.LimitReader(reader, options.MaxBytes+1))
	if copyErr != nil {
		return VideoReferenceUpload{}, copyErr
	}
	if written > options.MaxBytes {
		return VideoReferenceUpload{}, ErrVideoReferenceTooLarge
	}
	if err := file.Sync(); err != nil {
		return VideoReferenceUpload{}, err
	}
	if err := file.Close(); err != nil {
		return VideoReferenceUpload{}, err
	}
	headerFile, err := os.Open(temporaryPath)
	if err != nil {
		return VideoReferenceUpload{}, err
	}
	header := make([]byte, 12)
	headerSize, readErr := io.ReadFull(headerFile, header)
	_ = headerFile.Close()
	if readErr != nil && !errors.Is(readErr, io.ErrUnexpectedEOF) {
		return VideoReferenceUpload{}, readErr
	}
	_, contentType, err := videoReferenceFormat(originalName, header[:headerSize])
	if err != nil {
		return VideoReferenceUpload{}, err
	}
	if err := os.Chtimes(temporaryPath, options.Now, options.Now); err != nil {
		return VideoReferenceUpload{}, err
	}
	if err := os.Rename(temporaryPath, finalPath); err != nil {
		return VideoReferenceUpload{}, err
	}
	keep = true
	contentURL, err := BuildVideoReferenceContentURL(fileID, options.Now.Add(VideoReferenceTTL))
	if err != nil {
		_ = os.Remove(finalPath)
		return VideoReferenceUpload{}, err
	}
	return VideoReferenceUpload{ID: fileID, URL: contentURL, Name: filepath.Base(originalName), ContentType: contentType, Size: written}, nil
}

func videoReferenceAccessMessage(fileID string, expires int64) []byte {
	return []byte(videoReferenceAccessVersion + "\x00" + fileID + "\x00" + strconv.FormatInt(expires, 10))
}

func IssueVideoReferenceAccess(fileID string, expires time.Time) (string, error) {
	if !videoReferenceFilePattern.MatchString(fileID) || expires.IsZero() || common.CryptoSecret == "" {
		return "", ErrVideoReferenceInvalid
	}
	mac := hmac.New(sha256.New, []byte(common.CryptoSecret))
	_, _ = mac.Write(videoReferenceAccessMessage(fileID, expires.Unix()))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func VerifyVideoReferenceAccess(access, fileID string, expires int64, now time.Time) bool {
	if !videoReferenceFilePattern.MatchString(fileID) || expires <= now.Unix() || common.CryptoSecret == "" {
		return false
	}
	actual, err := base64.RawURLEncoding.Strict().DecodeString(access)
	if err != nil || len(actual) != sha256.Size {
		return false
	}
	mac := hmac.New(sha256.New, []byte(common.CryptoSecret))
	_, _ = mac.Write(videoReferenceAccessMessage(fileID, expires))
	return hmac.Equal(actual, mac.Sum(nil))
}

func BuildVideoReferenceContentURL(fileID string, expires time.Time) (string, error) {
	if !videoReferenceFilePattern.MatchString(fileID) {
		return "", ErrVideoReferenceInvalid
	}
	baseAddress := strings.TrimSpace(system_setting.TaskPublicAddress)
	if baseAddress == "" {
		baseAddress = strings.TrimSpace(system_setting.ServerAddress)
	}
	if err := ValidateTaskArtifactBaseURL(baseAddress); err != nil {
		return "", err
	}
	baseURL, err := url.Parse(baseAddress)
	if err != nil {
		return "", err
	}
	access, err := IssueVideoReferenceAccess(fileID, expires)
	if err != nil {
		return "", err
	}
	baseURL.Path = strings.TrimRight(baseURL.Path, "/") + "/v1/video-reference-files/" + fileID + "/content"
	query := baseURL.Query()
	query.Set("expires", strconv.FormatInt(expires.Unix(), 10))
	query.Set("access", access)
	baseURL.RawQuery = query.Encode()
	return baseURL.String(), nil
}

func OpenVideoReference(directory, fileID string) (*os.File, string, error) {
	if !videoReferenceFilePattern.MatchString(fileID) {
		return nil, "", ErrVideoReferenceInvalid
	}
	path := filepath.Join(directory, fileID)
	file, err := os.Open(path)
	if err != nil {
		return nil, "", err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = file.Close()
		if err != nil {
			return nil, "", err
		}
		return nil, "", ErrVideoReferenceInvalid
	}
	contentType := "video/mp4"
	if strings.HasSuffix(fileID, ".mov") {
		contentType = "video/quicktime"
	}
	return file, contentType, nil
}

func CleanupVideoReferenceUploads(directory string, now time.Time) (VideoReferenceCleanupResult, error) {
	result := VideoReferenceCleanupResult{}
	entries, err := os.ReadDir(directory)
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	for _, entry := range entries {
		result.Scanned++
		name := entry.Name()
		isFinal := videoReferenceFilePattern.MatchString(name)
		isUploading := videoReferenceUploadingPattern.MatchString(name)
		if !isFinal && !isUploading {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil || !info.Mode().IsRegular() {
			result.Failed++
			continue
		}
		ttl := VideoReferenceTTL
		if isUploading {
			ttl = VideoReferenceUploadingTTL
		}
		if now.Sub(info.ModTime()) <= ttl {
			continue
		}
		if removeErr := os.Remove(filepath.Join(directory, name)); removeErr != nil {
			result.Failed++
			continue
		}
		result.Deleted++
		result.FreedBytes += info.Size()
	}
	return result, nil
}

func ParseVideoReferenceExpiry(raw string) (int64, error) {
	expires, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || expires <= 0 {
		return 0, fmt.Errorf("%w: invalid expiry", ErrVideoReferenceInvalid)
	}
	return expires, nil
}
