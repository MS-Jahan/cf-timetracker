# GitHub Actions Workflow — Flutter Builds

## Overview

This workflow builds the Flutter app for Android, Linux, and Windows platforms with strict time limits to prevent excessive GitHub Actions usage.

## Time Limits

### Why Time Limits?

GitHub Actions provides **2,000 minutes/month** for free (private repos) or **unlimited** for public repos. However, excessive build times can:
- Consume your monthly quota quickly
- Cause workflow failures due to timeouts
- Impact other workflows

### Platform-Specific Limits

| Platform | Time Limit | Typical Build Time | Reason |
|----------|------------|-------------------|--------|
| **Android** | 25 minutes | 15-20 minutes | APK + AAB builds, Gradle compilation |
| **Linux** | 20 minutes | 10-15 minutes | Native compilation with dependencies |
| **Windows** | 25 minutes | 15-20 minutes | Native compilation with MSVC |
| **Tests** | 5 minutes | 2-3 minutes | Unit tests should be fast |

### Total Maximum Time

- **All platforms**: ~70 minutes (if all run in parallel)
- **Actual total**: ~30-40 minutes (parallel execution)

## How It Works

### Triggers

1. **Push to main/develop**: Builds all platforms when `apps/timetracker/` changes
2. **Pull requests**: Builds all platforms to validate changes
3. **Manual dispatch**: Build specific platform(s) on demand

### Caching Strategy

The workflow uses aggressive caching to speed up subsequent builds:

```yaml
# Flutter SDK cache
- uses: subosito/flutter-action@v2
  with:
    flutter-version: '3.24.0'
    cache: true
    cache-key: 'flutter-3.24.0'

# Gradle cache (Android)
- uses: actions/setup-java@v4
  with:
    cache: 'gradle'

# Dependencies cached separately per platform
cache-key: 'flutter-3.24.0-linux'
cache-key: 'flutter-3.24.0-windows'
```

### Artifact Retention

Artifacts are kept for **7 days** only:
- Saves GitHub storage quota
- Prevents accumulation of old builds
- Forces fresh builds for releases

## Usage

### Automatic Builds

Just push code to `main` or `develop`:

```bash
git push origin main
```

### Manual Builds

Go to **Actions** → **Build Flutter Apps** → **Run workflow**:

1. Select platform: `all`, `android`, `linux`, or `windows`
2. Click **Run workflow**

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

### Monitor Usage

Check your usage at:
- GitHub → Settings → Billing → Actions

## Troubleshooting

### Build Timeout

If a build exceeds the time limit:

1. Check the logs for slow steps
2. Verify dependencies are cached
3. Consider increasing timeout (but be mindful of quota)

### Failed Builds

Common issues:

| Error | Cause | Solution |
|-------|-------|----------|
| `flutter: command not found` | Flutter not installed | Check `subosito/flutter-action` version |
| `gradle: command not found` | Android SDK missing | Verify Java setup |
| `cmake: not found` | Linux dependencies missing | Check `apt-get install` step |

### Cache Issues

If builds are slow despite caching:

1. Clear cache: Actions → Caches → Delete
2. Update cache key: Change `flutter-3.24.0` to new version
3. Check cache hit rate in logs

## Best Practices

### For Contributors

1. **Test locally first**: `flutter build apk --debug`
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

**Last Updated:** 2026-09-20  
**Workflow File:** `.github/workflows/build.yml`
