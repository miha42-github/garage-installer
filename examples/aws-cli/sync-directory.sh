#!/bin/bash
#
# Garage S3 - Directory Synchronization Example
#
# This script demonstrates how to use AWS S3 sync for backup and restore
# workflows with Garage.
#
# Use cases:
#   - Backup local directories to S3
#   - Restore from S3 backups
#   - Mirror directories
#   - Continuous synchronization
#
# Prerequisites:
#   - AWS CLI installed
#   - Garage cluster running
#   - Access credentials configured
#
# Usage:
#   ./sync-directory.sh backup /path/to/directory
#   ./sync-directory.sh restore /path/to/directory
#   ./sync-directory.sh mirror /path/to/source /path/to/dest
#

set -e

# Configuration
GARAGE_ENDPOINT="${GARAGE_ENDPOINT:-http://192.168.1.100:3900}"
BACKUP_BUCKET="${BACKUP_BUCKET:-backups}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${BLUE}==>${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }

# Ensure bucket exists
ensure_bucket() {
    log "Ensuring backup bucket exists..."
    if aws s3 mb "s3://$BACKUP_BUCKET" --endpoint-url "$GARAGE_ENDPOINT" 2>/dev/null; then
        success "Bucket created: $BACKUP_BUCKET"
    else
        log "Bucket already exists: $BACKUP_BUCKET"
    fi
}

# Backup directory to S3
backup_directory() {
    local source_dir="$1"
    local backup_name="${2:-$(basename "$source_dir")}"
    
    if [ ! -d "$source_dir" ]; then
        error "Source directory not found: $source_dir"
        exit 1
    fi
    
    log "Backing up: $source_dir"
    log "Destination: s3://$BACKUP_BUCKET/$backup_name-$TIMESTAMP/"
    
    # Sync with progress
    aws s3 sync "$source_dir" "s3://$BACKUP_BUCKET/$backup_name-$TIMESTAMP/" \
        --endpoint-url "$GARAGE_ENDPOINT" \
        --delete \
        --exact-timestamps \
        --no-progress
    
    # Calculate statistics
    local file_count=$(find "$source_dir" -type f | wc -l | tr -d ' ')
    local total_size=$(du -sh "$source_dir" | cut -f1)
    
    success "Backup complete!"
    echo "  Files backed up: $file_count"
    echo "  Total size: $total_size"
    echo "  Backup location: s3://$BACKUP_BUCKET/$backup_name-$TIMESTAMP/"
}

# Restore directory from S3
restore_directory() {
    local dest_dir="$1"
    local backup_path="$2"
    
    if [ -z "$backup_path" ]; then
        error "Backup path required. List available backups with:"
        echo "  aws s3 ls s3://$BACKUP_BUCKET/ --endpoint-url $GARAGE_ENDPOINT"
        exit 1
    fi
    
    log "Restoring from: s3://$BACKUP_BUCKET/$backup_path/"
    log "Destination: $dest_dir"
    
    # Create destination if it doesn't exist
    mkdir -p "$dest_dir"
    
    # Sync from S3
    aws s3 sync "s3://$BACKUP_BUCKET/$backup_path/" "$dest_dir" \
        --endpoint-url "$GARAGE_ENDPOINT" \
        --exact-timestamps \
        --no-progress
    
    success "Restore complete!"
    echo "  Restored to: $dest_dir"
}

# Mirror two directories
mirror_directories() {
    local source_dir="$1"
    local dest_dir="$2"
    
    if [ ! -d "$source_dir" ]; then
        error "Source directory not found: $source_dir"
        exit 1
    fi
    
    log "Mirroring directories..."
    log "Source: $source_dir"
    log "Dest:   $dest_dir"
    
    # Sync to S3 first (upload)
    aws s3 sync "$source_dir" "s3://$BACKUP_BUCKET/mirror/" \
        --endpoint-url "$GARAGE_ENDPOINT" \
        --delete \
        --exact-timestamps
    
    # Sync from S3 to destination (download)
    mkdir -p "$dest_dir"
    aws s3 sync "s3://$BACKUP_BUCKET/mirror/" "$dest_dir" \
        --endpoint-url "$GARAGE_ENDPOINT" \
        --delete \
        --exact-timestamps
    
    success "Mirror complete!"
}

# List available backups
list_backups() {
    log "Available backups in $BACKUP_BUCKET:"
    echo ""
    aws s3 ls "s3://$BACKUP_BUCKET/" --endpoint-url "$GARAGE_ENDPOINT"
    echo ""
}

# Incremental backup (only changed files)
incremental_backup() {
    local source_dir="$1"
    local backup_name="${2:-$(basename "$source_dir")}"
    
    if [ ! -d "$source_dir" ]; then
        error "Source directory not found: $source_dir"
        exit 1
    fi
    
    log "Incremental backup: $source_dir"
    log "Destination: s3://$BACKUP_BUCKET/$backup_name/"
    
    # Sync without --delete (keeps old files)
    aws s3 sync "$source_dir" "s3://$BACKUP_BUCKET/$backup_name/" \
        --endpoint-url "$GARAGE_ENDPOINT" \
        --exact-timestamps \
        --size-only
    
    success "Incremental backup complete!"
}

# Exclude patterns example
backup_with_excludes() {
    local source_dir="$1"
    local backup_name="${2:-$(basename "$source_dir")}"
    
    if [ ! -d "$source_dir" ]; then
        error "Source directory not found: $source_dir"
        exit 1
    fi
    
    log "Backing up with exclusions: $source_dir"
    
    aws s3 sync "$source_dir" "s3://$BACKUP_BUCKET/$backup_name-$TIMESTAMP/" \
        --endpoint-url "$GARAGE_ENDPOINT" \
        --exclude "*.tmp" \
        --exclude "*.log" \
        --exclude ".git/*" \
        --exclude "node_modules/*" \
        --exclude "__pycache__/*" \
        --delete \
        --exact-timestamps
    
    success "Backup with exclusions complete!"
}

# Show usage
usage() {
    cat << EOF
Usage: $0 <command> [arguments]

Commands:
  backup <dir> [name]           Backup directory to S3
  restore <dir> <backup-path>   Restore from S3 backup
  mirror <source> <dest>        Mirror directories via S3
  list                          List available backups
  incremental <dir> [name]      Incremental backup (no delete)
  exclude <dir> [name]          Backup with common exclusions

Examples:
  # Backup a directory
  $0 backup ~/documents

  # Backup with custom name
  $0 backup ~/photos vacation-photos

  # List available backups
  $0 list

  # Restore a specific backup
  $0 restore ~/restored-documents documents-20251116-143022

  # Mirror directories
  $0 mirror ~/source ~/destination

  # Incremental backup (keeps old files)
  $0 incremental ~/documents

  # Backup excluding common patterns
  $0 exclude ~/project

Environment Variables:
  GARAGE_ENDPOINT    S3 endpoint URL (default: http://192.168.1.100:3900)
  BACKUP_BUCKET      Bucket name for backups (default: backups)

EOF
}

# Main
main() {
    if [ $# -lt 1 ]; then
        usage
        exit 1
    fi
    
    ensure_bucket
    
    case "$1" in
        backup)
            backup_directory "$2" "$3"
            ;;
        restore)
            if [ $# -lt 3 ]; then
                error "Usage: $0 restore <destination-dir> <backup-path>"
                exit 1
            fi
            restore_directory "$2" "$3"
            ;;
        mirror)
            if [ $# -lt 3 ]; then
                error "Usage: $0 mirror <source-dir> <dest-dir>"
                exit 1
            fi
            mirror_directories "$2" "$3"
            ;;
        list)
            list_backups
            ;;
        incremental)
            incremental_backup "$2" "$3"
            ;;
        exclude)
            backup_with_excludes "$2" "$3"
            ;;
        *)
            error "Unknown command: $1"
            usage
            exit 1
            ;;
    esac
}

main "$@"
