#!/bin/bash
# Test Flutter builds locally before pushing to GitHub
# This helps avoid wasting GitHub Actions minutes on broken builds

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
FLUTTER_DIR="apps/timetracker"
API_BASE_URL="http://localhost:8787"

# Function to print section headers
print_header() {
    echo ""
    echo "=================================="
    echo -e "${YELLOW}$1${NC}"
    echo "=================================="
}

# Function to check if command exists
check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}Error: $1 is not installed${NC}"
        exit 1
    fi
}

# Check prerequisites
print_header "Checking Prerequisites"
check_command flutter
check_command dart

# Navigate to Flutter directory
cd "$FLUTTER_DIR" || exit 1

print_header "Getting Dependencies"
flutter pub get

print_header "Running Tests"
flutter test --test-randomize-ordering-seed=0
echo -e "${GREEN}✅ Tests passed${NC}"

# Determine platform
PLATFORM="${1:-all}"

case "$PLATFORM" in
    "android")
        print_header "Building Android APK (debug)"
        flutter build apk --debug --dart-define=API_BASE_URL=$API_BASE_URL
        echo -e "${GREEN}✅ Android APK built successfully${NC}"
        ;;
    "linux")
        print_header "Building Linux desktop"
        flutter build linux --release --dart-define=API_BASE_URL=$API_BASE_URL
        echo -e "${GREEN}✅ Linux desktop built successfully${NC}"
        ;;
    "windows")
        print_header "Building Windows desktop"
        flutter build windows --release --dart-define=API_BASE_URL=$API_BASE_URL
        echo -e "${GREEN}✅ Windows desktop built successfully${NC}"
        ;;
    "all")
        print_header "Building All Platforms"
        
        echo "Building Android APK (debug)..."
        flutter build apk --debug --dart-define=API_BASE_URL=$API_BASE_URL
        echo -e "${GREEN}✅ Android APK built${NC}"
        
        echo "Building Linux desktop..."
        flutter build linux --release --dart-define=API_BASE_URL=$API_BASE_URL
        echo -e "${GREEN}✅ Linux desktop built${NC}"
        
        echo "Building Windows desktop..."
        flutter build windows --release --dart-define=API_BASE_URL=$API_BASE_URL
        echo -e "${GREEN}✅ Windows desktop built${NC}"
        ;;
    *)
        echo -e "${RED}Unknown platform: $PLATFORM${NC}"
        echo "Usage: $0 [android|linux|windows|all]"
        exit 1
        ;;
esac

print_header "Build Summary"
echo -e "${GREEN}All builds completed successfully!${NC}"
echo ""
echo "Build artifacts:"
if [ -d "build" ]; then
    find build -type f \( -name "*.apk" -o -name "*.aab" -o -name "*.exe" -o -name "flutter_linux*" \) | head -10
fi

echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Test the built application"
echo "2. If everything works, commit and push to GitHub"
echo "3. GitHub Actions will build for all platforms automatically"

cd - > /dev/null
