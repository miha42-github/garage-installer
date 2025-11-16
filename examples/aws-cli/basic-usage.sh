#!/bin/bash
#
# Garage S3 - AWS CLI Basic Usage Examples
#
# This script demonstrates common S3 operations using the AWS CLI
# with a Garage cluster.
#
# Prerequisites:
#   - AWS CLI installed: https://aws.amazon.com/cli/
#   - Garage cluster running
#   - Access credentials created
#
# Usage:
#   1. Configure environment variables (see below)
#   2. Make executable: chmod +x basic-usage.sh
#   3. Run: ./basic-usage.sh
#

set -e  # Exit on error

# Configuration - Update these values
GARAGE_ENDPOINT="${GARAGE_ENDPOINT:-http://192.168.1.100:3900}"
GARAGE_ACCESS_KEY="${GARAGE_ACCESS_KEY:-}"
GARAGE_SECRET_KEY="${GARAGE_SECRET_KEY:-}"
BUCKET_NAME="${BUCKET_NAME:-test-bucket}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function
log() {
    echo -e "${BLUE}==>${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

warn() {
    echo -e "${YELLOW}!${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    if ! command -v aws &> /dev/null; then
        echo "Error: AWS CLI not found. Install it first:"
        echo "  brew install awscli  # macOS"
        echo "  pip install awscli   # Python"
        exit 1
    fi
    
    if [ -z "$GARAGE_ACCESS_KEY" ] || [ -z "$GARAGE_SECRET_KEY" ]; then
        echo "Error: Credentials not set. Export these variables:"
        echo "  export GARAGE_ACCESS_KEY='your_access_key'"
        echo "  export GARAGE_SECRET_KEY='your_secret_key'"
        exit 1
    fi
    
    success "Prerequisites OK"
}

# Configure AWS CLI for Garage
configure_aws_cli() {
    log "Configuring AWS CLI for Garage..."
    
    aws configure set aws_access_key_id "$GARAGE_ACCESS_KEY"
    aws configure set aws_secret_access_key "$GARAGE_SECRET_KEY"
    aws configure set default.region garage
    aws configure set default.s3.addressing_style path
    
    success "AWS CLI configured"
}

# Create a test bucket
create_bucket() {
    log "Creating bucket: $BUCKET_NAME..."
    
    if aws s3 mb "s3://$BUCKET_NAME" --endpoint-url "$GARAGE_ENDPOINT" 2>/dev/null; then
        success "Bucket created: $BUCKET_NAME"
    else
        warn "Bucket already exists or creation failed (this is OK if it exists)"
    fi
}

# Upload files
upload_files() {
    log "Uploading files..."
    
    # Create test files
    echo "Hello from Garage S3!" > test1.txt
    echo "This is a test file" > test2.txt
    echo '{"message": "JSON data"}' > test3.json
    
    # Upload individual files
    aws s3 cp test1.txt "s3://$BUCKET_NAME/" --endpoint-url "$GARAGE_ENDPOINT"
    aws s3 cp test2.txt "s3://$BUCKET_NAME/" --endpoint-url "$GARAGE_ENDPOINT"
    aws s3 cp test3.json "s3://$BUCKET_NAME/data/" --endpoint-url "$GARAGE_ENDPOINT"
    
    success "Files uploaded"
}

# List bucket contents
list_files() {
    log "Listing bucket contents..."
    
    echo ""
    echo "All objects in $BUCKET_NAME:"
    aws s3 ls "s3://$BUCKET_NAME/" --recursive --endpoint-url "$GARAGE_ENDPOINT"
    echo ""
    
    success "Listing complete"
}

# Download files
download_files() {
    log "Downloading files..."
    
    # Create download directory
    mkdir -p downloads
    
    # Download specific file
    aws s3 cp "s3://$BUCKET_NAME/test1.txt" downloads/ --endpoint-url "$GARAGE_ENDPOINT"
    
    # Download with different name
    aws s3 cp "s3://$BUCKET_NAME/test2.txt" downloads/renamed.txt --endpoint-url "$GARAGE_ENDPOINT"
    
    success "Files downloaded to ./downloads/"
}

# Copy within bucket
copy_files() {
    log "Copying files within bucket..."
    
    # Copy to new location
    aws s3 cp "s3://$BUCKET_NAME/test1.txt" "s3://$BUCKET_NAME/backup/test1.txt" \
        --endpoint-url "$GARAGE_ENDPOINT"
    
    success "File copied"
}

# Set metadata
set_metadata() {
    log "Setting object metadata..."
    
    # Upload with metadata
    aws s3 cp test1.txt "s3://$BUCKET_NAME/with-metadata.txt" \
        --endpoint-url "$GARAGE_ENDPOINT" \
        --metadata "author=test,version=1.0" \
        --content-type "text/plain; charset=utf-8"
    
    success "Metadata set"
}

# Get object information
get_object_info() {
    log "Getting object information..."
    
    echo ""
    echo "Object metadata:"
    aws s3api head-object \
        --bucket "$BUCKET_NAME" \
        --key "with-metadata.txt" \
        --endpoint-url "$GARAGE_ENDPOINT"
    echo ""
    
    success "Object info retrieved"
}

# Delete specific files
delete_files() {
    log "Deleting specific files..."
    
    aws s3 rm "s3://$BUCKET_NAME/test2.txt" --endpoint-url "$GARAGE_ENDPOINT"
    
    success "File deleted"
}

# Sync directory
sync_directory() {
    log "Syncing directory..."
    
    # Create local directory with files
    mkdir -p sync-test
    echo "File 1" > sync-test/file1.txt
    echo "File 2" > sync-test/file2.txt
    
    # Sync to S3
    aws s3 sync sync-test/ "s3://$BUCKET_NAME/synced/" --endpoint-url "$GARAGE_ENDPOINT"
    
    success "Directory synced"
}

# Generate presigned URL
generate_presigned_url() {
    log "Generating presigned URL..."
    
    URL=$(aws s3 presign "s3://$BUCKET_NAME/test1.txt" \
        --endpoint-url "$GARAGE_ENDPOINT" \
        --expires-in 3600)
    
    echo ""
    echo "Presigned URL (valid for 1 hour):"
    echo "$URL"
    echo ""
    echo "Test with: curl '$URL'"
    echo ""
    
    success "Presigned URL generated"
}

# Show bucket statistics
show_statistics() {
    log "Calculating bucket statistics..."
    
    echo ""
    aws s3 ls "s3://$BUCKET_NAME/" --recursive --summarize --human-readable \
        --endpoint-url "$GARAGE_ENDPOINT"
    echo ""
    
    success "Statistics displayed"
}

# Cleanup (optional)
cleanup() {
    log "Cleaning up test files..."
    
    # Remove test bucket (must be empty first)
    aws s3 rm "s3://$BUCKET_NAME/" --recursive --endpoint-url "$GARAGE_ENDPOINT"
    aws s3 rb "s3://$BUCKET_NAME" --endpoint-url "$GARAGE_ENDPOINT"
    
    # Remove local files
    rm -f test1.txt test2.txt test3.json
    rm -rf downloads sync-test
    
    success "Cleanup complete"
}

# Main execution
main() {
    echo ""
    echo "======================================"
    echo "  Garage S3 - AWS CLI Examples"
    echo "======================================"
    echo ""
    echo "Endpoint: $GARAGE_ENDPOINT"
    echo "Bucket:   $BUCKET_NAME"
    echo ""
    
    check_prerequisites
    configure_aws_cli
    
    echo ""
    echo "--- Basic Operations ---"
    create_bucket
    upload_files
    list_files
    download_files
    
    echo ""
    echo "--- Advanced Operations ---"
    copy_files
    set_metadata
    get_object_info
    sync_directory
    generate_presigned_url
    show_statistics
    
    echo ""
    echo "--- Cleanup ---"
    read -p "Delete test bucket and files? (y/N) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cleanup
    else
        warn "Skipping cleanup. To clean up later, run:"
        echo "  aws s3 rm s3://$BUCKET_NAME/ --recursive --endpoint-url $GARAGE_ENDPOINT"
        echo "  aws s3 rb s3://$BUCKET_NAME --endpoint-url $GARAGE_ENDPOINT"
    fi
    
    echo ""
    success "All examples completed!"
    echo ""
    echo "Next steps:"
    echo "  - Try modifying the examples"
    echo "  - Check other examples in this directory"
    echo "  - Read the full documentation: ../docs/"
    echo ""
}

# Run main function
main
