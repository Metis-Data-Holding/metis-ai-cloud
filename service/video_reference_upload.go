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
	"slices"
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
	videoReferenceRawIDPattern     = regexp.MustCompile(`^[0-9A-Za-z]{24}$`)
	videoReferenceFilePattern      = regexp.MustCompile(`^[0-9A-Za-z]{24}\.(mp4|mov|mp3|wav)$`)
	videoReferenceUploadingPattern = regexp.MustCompile(`^[0-9A-Za-z]{24}\.(mp4|mov|mp3|wav)\.uploading$`)
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
	switch extension {
	case ".mp4", ".mov":
		if len(header) < 8 || string(header[4:8]) != "ftyp" {
			return "", "", ErrVideoReferenceUnsupported
		}
		if extension == ".mov" {
			return extension, "video/quicktime", nil
		}
		return extension, "video/mp4", nil
	case ".wav":
		if len(header) < 12 || string(header[:4]) != "RIFF" || string(header[8:12]) != "WAVE" {
			return "", "", ErrVideoReferenceUnsupported
		}
		return extension, "audio/wav", nil
	case ".mp3":
		if len(header) < 3 || (string(header[:3]) != "ID3" && !(header[0] == 0xff && header[1]&0xe0 == 0xe0)) {
			return "", "", ErrVideoReferenceUnsupported
		}
		return extension, "audio/mpeg", nil
	default:
		return "", "", ErrVideoReferenceUnsupported
	}
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
	if err != nil || !videoReferenceRawIDPattern.MatchString(id) {
		return VideoReferenceUpload{}, ErrVideoReferenceInvalid
	}
	extension := strings.ToLower(filepath.Ext(strings.TrimSpace(originalName)))
	if !slices.Contains([]string{".mp4", ".mov", ".mp3", ".wav"}, extension) {
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

// removeVideoReferenceContentURL 只删除本系统当前公网址和有效签名对应的文件。
// 调用方仅传入自己刚创建的中转地址，用户上传地址不会被误删。
func removeVideoReferenceContentURL(rawURL string) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return
	}
	baseAddress := strings.TrimSpace(system_setting.TaskPublicAddress)
	if baseAddress == "" {
		baseAddress = strings.TrimSpace(system_setting.ServerAddress)
	}
	baseURL, err := url.Parse(baseAddress)
	if err != nil || baseURL.Scheme != parsed.Scheme || baseURL.Host != parsed.Host {
		return
	}
	prefix := strings.TrimRight(baseURL.Path, "/") + "/v1/video-reference-files/"
	if !strings.HasPrefix(parsed.Path, prefix) || !strings.HasSuffix(parsed.Path, "/content") {
		return
	}
	fileID := strings.TrimSuffix(strings.TrimPrefix(parsed.Path, prefix), "/content")
	expires, err := ParseVideoReferenceExpiry(parsed.Query().Get("expires"))
	if err != nil || !VerifyVideoReferenceAccess(parsed.Query().Get("access"), fileID, expires, time.Now()) {
		return
	}
	_ = os.Remove(filepath.Join(VideoReferenceUploadDirectory(), fileID))
}

func OpenVideoReference(directory, fileID string) (*os.File, string, error) {
	if !videoReferenceFilePattern.MatchString(fileID) {
		return nil, "", ErrVideoReferenceInvalid
	}
	path := filepath.Join(directory, fileID)
	pathInfo, err := os.Lstat(path)
	if err != nil {
		return nil, "", err
	}
	if !pathInfo.Mode().IsRegular() {
		return nil, "", ErrVideoReferenceInvalid
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, "", err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || !os.SameFile(pathInfo, info) {
		_ = file.Close()
		if err != nil {
			return nil, "", err
		}
		return nil, "", ErrVideoReferenceInvalid
	}
	contentType := "video/mp4"
	if strings.HasSuffix(fileID, ".mov") {
		contentType = "video/quicktime"
	} else if strings.HasSuffix(fileID, ".mp3") {
		contentType = "audio/mpeg"
	} else if strings.HasSuffix(fileID, ".wav") {
		contentType = "audio/wav"
	}
	return file, contentType, nil
}

func CleanupVideoReferenceUploads(directory string, now time.Time, reportProgress func(processed, total int)) (VideoReferenceCleanupResult, error) {
	result := VideoReferenceCleanupResult{}
	entries, err := os.ReadDir(directory)
	if errors.Is(err, os.ErrNotExist) {
		if reportProgress != nil {
			reportProgress(0, 0)
		}
		return result, nil
	}
	if err != nil {
		return result, err
	}
	if reportProgress != nil {
		reportProgress(0, len(entries))
	}
	for index, entry := range entries {
		result.Scanned++
		name := entry.Name()
		isFinal := videoReferenceFilePattern.MatchString(name)
		isUploading := videoReferenceUploadingPattern.MatchString(name)
		if isFinal || isUploading {
			info, infoErr := entry.Info()
			if infoErr != nil || !info.Mode().IsRegular() {
				result.Failed++
			} else {
				ttl := VideoReferenceTTL
				if isUploading {
					ttl = VideoReferenceUploadingTTL
				}
				if now.Sub(info.ModTime()) > ttl {
					if removeErr := os.Remove(filepath.Join(directory, name)); removeErr != nil {
						result.Failed++
					} else {
						result.Deleted++
						result.FreedBytes += info.Size()
					}
				}
			}
		}
		if reportProgress != nil {
			reportProgress(index+1, len(entries))
		}
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
