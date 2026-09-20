# GitHub Actions Workflow - Flutter Builds

**Date:** 2026-09-20  
**Status:** ✅ Complete

## Overview

Created a GitHub Actions workflow to build Flutter apps for Android, Linux, and Windows with strict time limits to prevent excessive GitHub Actions usage.

## Files Created

### 1. `.github/workflows/build.yml`
Main workflow file with:
- **Android build**: APK + AAB with 25-minute timeout
- **Linux build**: Desktop app with 20-minute timeout
- **Windows build**: Desktop app with 25-minute timeout
- **Test step**: 5-minute timeout for unit tests
- **Caching**: Flutter SDK, Gradle, dependencies
- **Parallel execution**: All platforms build simultaneously
- **Artifact retention**: 7 days to save storage

### 2. `.github/workflows/README.md`
Comprehensive documentation covering:
- Time limits and why they're needed
- Platform-specific limits and typical build times
- Cost optimization strategies
- Troubleshooting guide
- Best practices for contributors and maintainers

### 3. `scripts/test-builds.sh`
Local testing script to:
- Run tests before pushing
- Build for specific platform or all platforms
- Verify builds work locally before GitHub Actions
- Save GitHub Actions minutes by catching issues early

## Time Limits

### Why Time Limits?

GitHub Actions provides **2,000 minutes/month** for free (private repos). Excessive build times can:
- Consume monthly quota quickly
- Cause workflow failures
- Impact other workflows

### Platform Limits

| Platform | Time Limit | Typical Build | Notes |
|----------|------------|---------------|-------|
| **Android** | 25 min | 15-20 min | APK + AAB builds |
| **Linux** | 20 min | 10-15 min | Native compilation |
| **Windows** | 25 min | 15-20 min | MSVC compilation |
| **Tests** | 5 min | 2-3 min | Unit tests only |

### Total Maximum

- **All platforms**: ~70 minutes (theoretical max)
- **Actual total**: ~30-40 minutes (parallel execution)
- **Monthly usage** (30 builds): ~900-1200 minutes
- **Remaining quota**: ~800-1100 minutes

## Usage

### Automatic Builds

Push to `main` or `develop`:
```bash
git push origin main
```

### Manual Builds

1. Go to **Actions** → **Build Flutter Apps**
2. Click **Run workflow**
3. Select platform: `all`, `android`, `linux`, or `windows`
4. Click **Run workflow**

### Local Testing

Before pushing to GitHub:
```bash
# Test all platforms
./scripts/test-builds.sh all

# Test specific platform
./scripts/test-builds.sh android
./scripts/test-builds.sh linux
./scripts/test-builds.sh windows
```

### Download Artifacts

1. Go to **Actions** → Select workflow run
2. Scroll to **Artifacts** section
3. Click platform name to download

## Cost Optimization

### Monthly Quota Usage

Assuming **30 builds/month** with all platforms:

| Metric | Value |
|--------|-------|
| Build time per run | ~30-40 minutes |
| Monthly total | ~900-1200 minutes |
| Free quota (private) | 2,000 minutes |
| **Remaining** | **800-1100 minutes** |

### Tips to Reduce Usage

1. **Use manual dispatch** for non-critical builds
2. **Skip unnecessary builds** with path filters
3. **Cache dependencies** (already implemented)
4. **Cancel in-progress runs** (already implemented)
5. **Test locally first** with `scripts/test-builds.sh`

### Monitor Usage

Check your usage at:
- GitHub → Settings → Billing → Actions

## Features

### Caching Strategy

```yaml
# Flutter SDK cache
- uses: subosito/flutter-action@v2
  with:
    cache: true
    cache-key: 'flutter-3.24.0'

# Gradle cache (Android)
- uses: actions/setup-java@v4
  with:
    cache: 'gradle'

# Platform-specific dependency caching
cache-key: 'flutter-3.24.0-linux'
cache-key: 'flutter-3.24.0-windows'
```

### Path Filters

Only builds when relevant files change:
```yaml
paths:
  - 'apps/timetracker/**'
  - '.github/workflows/build.yml'
```

### Concurrency Control

Cancels in-progress runs for same branch/PR:
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

### PR Comments

Automatically comments on PRs with build status:
```markdown
## 🚀 Flutter Build Results

| Platform | Status | Artifact |
|----------|--------|----------|
| Android | ✅ | Download |
| Linux | ✅ | Download |
| Windows | ✅ | Download |
```

## Troubleshooting

### Build Timeout

If a build exceeds time limit:
1. Check logs for slow steps
2. Verify dependencies are cached
3. Consider increasing timeout (but check quota)

### Failed Builds

| Error | Cause | Solution |
|-------|-------|----------|
| `flutter: command not found` | Flutter not installed | Check `subosito/flutter-action` version |
| `gradle: command not found` | Android SDK missing | Verify Java setup |
| `cmake: not found` | Linux dependencies missing | Check `apt-get install` step |

### Cache Issues

If builds are slow:
1. Clear cache: Actions → Caches → Delete
2. Update cache key in workflow
3. Check cache hit rate in logs

## Best Practices

### For Contributors

1. **Test locally first**: `./scripts/test-builds.sh all`
2. **Run tests locally**: `flutter test`
3. **Use draft PRs** for work-in-progress
4. **Request review** before merging

### For Maintainers

1. **Monitor usage** weekly
2. **Adjust timeouts** based on actual build times
3. **Review cache effectiveness** monthly
4. **Clean up old artifacts** if storage is high

## Platform-Specific Notes

### Android

- Builds both **APK** (debug) and **AAB** (release)
- APK for testing, AAB for Play Store
- Uses Java 17 for compatibility

### Linux

- Requires system dependencies (clang, cmake, etc.)
- Builds native executable with GTK
- Packages as `.tar.gz` for easy distribution

### Windows

- Uses MSVC compiler from GitHub runner
- Builds `.exe` with all dependencies
- Packages as `.zip` for easy distribution

## Future Improvements

### Potential Enhancements

1. **iOS builds**: Add macOS runner for iOS
2. **Code signing**: Automate APK/AAB signing
3. **Release automation**: Publish to Play Store
4. **Performance monitoring**: Track build times over time

### Cost Reduction

1. **Self-hosted runners**: For high-volume builds
2. **Build matrix optimization**: Parallel vs sequential
3. **Conditional builds**: Skip on doc-only changes

---

**Status:** ✅ Complete  
**Last Updated:** 2026-09-20  
**Workflow File:** `.github/workflows/build.yml`  
**Documentation:** `.github/workflows/README.md`  
**Local Testing:** `scripts/test-builds.sh`
