#!/bin/bash
#
# Garage S3 - Static Website Hosting Example
#
# This script demonstrates how to deploy and manage static websites
# on Garage S3 using the AWS CLI.
#
# Features:
#   - Upload website files
#   - Configure bucket for website hosting
#   - Set proper content types
#   - Deploy with cache headers
#
# Prerequisites:
#   - AWS CLI installed
#   - Garage cluster running
#   - Access credentials configured
#
# Usage:
#   ./website-hosting.sh deploy /path/to/website
#   ./website-hosting.sh update /path/to/website
#   ./website-hosting.sh clean
#

set -e

# Configuration
GARAGE_ENDPOINT="${GARAGE_ENDPOINT:-http://192.168.1.100:3900}"
WEBSITE_BUCKET="${WEBSITE_BUCKET:-my-website}"
GARAGE_NODE="${GARAGE_NODE:-192.168.1.100}"
S3_WEB_PORT="${S3_WEB_PORT:-3902}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${BLUE}==>${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

# Create and configure bucket
setup_bucket() {
    log "Setting up website bucket: $WEBSITE_BUCKET"
    
    # Create bucket if it doesn't exist
    if aws s3 mb "s3://$WEBSITE_BUCKET" --endpoint-url "$GARAGE_ENDPOINT" 2>/dev/null; then
        success "Bucket created: $WEBSITE_BUCKET"
    else
        log "Bucket already exists"
    fi
    
    # Note: Garage doesn't support put-bucket-website via API
    # Website configuration is handled via garage.toml [s3_web] section
    # The bucket just needs to exist
    
    success "Bucket configured for website hosting"
}

# Create example website
create_example_website() {
    local site_dir="$1"
    
    log "Creating example website in: $site_dir"
    mkdir -p "$site_dir"
    
    # Create index.html
    cat > "$site_dir/index.html" << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Garage S3 Website</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>Welcome to My Garage S3 Website</h1>
    </header>
    <main>
        <p>This website is hosted on Garage S3!</p>
        <p><a href="about.html">Learn more</a></p>
    </main>
    <footer>
        <p>Powered by Garage S3</p>
    </footer>
    <script src="app.js"></script>
</body>
</html>
EOF

    # Create styles.css
    cat > "$site_dir/styles.css" << 'EOF'
body {
    font-family: Arial, sans-serif;
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
    background-color: #f5f5f5;
}

header {
    background-color: #333;
    color: white;
    padding: 20px;
    border-radius: 5px;
}

main {
    background-color: white;
    padding: 20px;
    margin: 20px 0;
    border-radius: 5px;
}

footer {
    text-align: center;
    color: #666;
    margin-top: 20px;
}

a {
    color: #0066cc;
}
EOF

    # Create app.js
    cat > "$site_dir/app.js" << 'EOF'
console.log('Website loaded from Garage S3!');
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM ready');
});
EOF

    # Create about.html
    cat > "$site_dir/about.html" << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>About - My Garage S3 Website</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>About This Site</h1>
    </header>
    <main>
        <p>This is a static website hosted on Garage S3.</p>
        <p><a href="index.html">Back to home</a></p>
    </main>
</body>
</html>
EOF

    success "Example website created"
}

# Upload website with proper content types
upload_website() {
    local site_dir="$1"
    
    if [ ! -d "$site_dir" ]; then
        error "Website directory not found: $site_dir"
        exit 1
    fi
    
    log "Uploading website from: $site_dir"
    
    # Upload HTML files
    find "$site_dir" -name "*.html" -type f | while read file; do
        local key="${file#$site_dir/}"
        log "Uploading: $key"
        aws s3 cp "$file" "s3://$WEBSITE_BUCKET/$key" \
            --endpoint-url "$GARAGE_ENDPOINT" \
            --content-type "text/html; charset=utf-8" \
            --cache-control "public, max-age=300"
    done
    
    # Upload CSS files
    find "$site_dir" -name "*.css" -type f | while read file; do
        local key="${file#$site_dir/}"
        log "Uploading: $key"
        aws s3 cp "$file" "s3://$WEBSITE_BUCKET/$key" \
            --endpoint-url "$GARAGE_ENDPOINT" \
            --content-type "text/css; charset=utf-8" \
            --cache-control "public, max-age=31536000"  # 1 year for CSS
    done
    
    # Upload JS files
    find "$site_dir" -name "*.js" -type f | while read file; do
        local key="${file#$site_dir/}"
        log "Uploading: $key"
        aws s3 cp "$file" "s3://$WEBSITE_BUCKET/$key" \
            --endpoint-url "$GARAGE_ENDPOINT" \
            --content-type "text/javascript; charset=utf-8" \
            --cache-control "public, max-age=31536000"  # 1 year for JS
    done
    
    # Upload images (if any)
    for ext in jpg jpeg png gif svg webp; do
        find "$site_dir" -name "*.$ext" -type f 2>/dev/null | while read file; do
            local key="${file#$site_dir/}"
            log "Uploading: $key"
            aws s3 cp "$file" "s3://$WEBSITE_BUCKET/$key" \
                --endpoint-url "$GARAGE_ENDPOINT" \
                --cache-control "public, max-age=31536000"
        done
    done
    
    success "Website uploaded successfully"
}

# Show website URL
show_url() {
    echo ""
    echo "======================================"
    echo "  Website Deployed!"
    echo "======================================"
    echo ""
    echo "Access your website at:"
    echo "  http://$WEBSITE_BUCKET.web.garage.localhost:$S3_WEB_PORT/"
    echo ""
    echo "Or configure DNS for:"
    echo "  http://$WEBSITE_BUCKET.your-domain.com:$S3_WEB_PORT/"
    echo ""
    warn "Note: You may need to configure /etc/hosts or DNS for the domain"
    echo ""
    echo "Example /etc/hosts entry:"
    echo "  $GARAGE_NODE  $WEBSITE_BUCKET.web.garage.localhost"
    echo ""
}

# List website files
list_files() {
    log "Website files:"
    echo ""
    aws s3 ls "s3://$WEBSITE_BUCKET/" --recursive --human-readable \
        --endpoint-url "$GARAGE_ENDPOINT"
    echo ""
}

# Delete all website files
clean_website() {
    log "Removing all website files..."
    
    aws s3 rm "s3://$WEBSITE_BUCKET/" --recursive --endpoint-url "$GARAGE_ENDPOINT"
    
    read -p "Delete bucket too? (y/N) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        aws s3 rb "s3://$WEBSITE_BUCKET" --endpoint-url "$GARAGE_ENDPOINT"
        success "Bucket deleted"
    fi
    
    success "Website cleaned up"
}

# Update specific files
update_files() {
    local site_dir="$1"
    shift
    local files=("$@")
    
    for file in "${files[@]}"; do
        local full_path="$site_dir/$file"
        if [ ! -f "$full_path" ]; then
            warn "File not found: $full_path"
            continue
        fi
        
        log "Updating: $file"
        
        # Determine content type
        local content_type="application/octet-stream"
        case "${file##*.}" in
            html) content_type="text/html; charset=utf-8" ;;
            css)  content_type="text/css; charset=utf-8" ;;
            js)   content_type="text/javascript; charset=utf-8" ;;
            json) content_type="application/json; charset=utf-8" ;;
            jpg|jpeg) content_type="image/jpeg" ;;
            png)  content_type="image/png" ;;
            svg)  content_type="image/svg+xml" ;;
        esac
        
        aws s3 cp "$full_path" "s3://$WEBSITE_BUCKET/$file" \
            --endpoint-url "$GARAGE_ENDPOINT" \
            --content-type "$content_type"
    done
    
    success "Files updated"
}

# Usage
usage() {
    cat << EOF
Usage: $0 <command> [arguments]

Commands:
  deploy <dir>          Deploy website from directory
  example               Create and deploy example website
  update <dir> [files]  Update specific files
  list                  List all website files
  clean                 Remove all website files
  url                   Show website URL

Examples:
  # Deploy existing website
  $0 deploy ./my-website

  # Create and deploy example
  $0 example

  # Update specific files
  $0 update ./my-website index.html styles.css

  # Show website URL
  $0 url

Environment Variables:
  GARAGE_ENDPOINT    S3 endpoint (default: http://192.168.1.100:3900)
  WEBSITE_BUCKET     Bucket name (default: my-website)
  GARAGE_NODE        Node IP for URL (default: 192.168.1.100)
  S3_WEB_PORT        Web port (default: 3902)

EOF
}

# Main
main() {
    if [ $# -lt 1 ]; then
        usage
        exit 1
    fi
    
    case "$1" in
        deploy)
            if [ -z "$2" ]; then
                error "Usage: $0 deploy <website-directory>"
                exit 1
            fi
            setup_bucket
            upload_website "$2"
            show_url
            ;;
        example)
            local temp_site="/tmp/garage-example-site-$$"
            create_example_website "$temp_site"
            setup_bucket
            upload_website "$temp_site"
            show_url
            warn "Example site created in: $temp_site"
            ;;
        update)
            if [ -z "$2" ]; then
                error "Usage: $0 update <website-directory> [files...]"
                exit 1
            fi
            update_files "$2" "${@:3}"
            ;;
        list)
            list_files
            ;;
        clean)
            clean_website
            ;;
        url)
            show_url
            ;;
        *)
            error "Unknown command: $1"
            usage
            exit 1
            ;;
    esac
}

main "$@"
