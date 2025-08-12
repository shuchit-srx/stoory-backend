#!/bin/bash

# Railway Deployment Script for Stoory Backend
# This script automates the deployment process and handles common issues

set -e  # Exit on any error

echo "🚀 Stoory Backend Railway Deployment Script"
echo "==========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Railway CLI is installed
check_railway_cli() {
    print_status "Checking Railway CLI installation..."
    
    if ! command -v railway &> /dev/null; then
        print_error "Railway CLI is not installed. Installing now..."
        npm install -g @railway/cli
        print_success "Railway CLI installed successfully"
    else
        print_success "Railway CLI is already installed"
    fi
    echo ""
}

# Check if user is logged in to Railway
check_railway_login() {
    print_status "Checking Railway login status..."
    
    if ! railway whoami &> /dev/null; then
        print_warning "Not logged in to Railway. Please log in..."
        railway login
    else
        print_success "Already logged in to Railway"
    fi
    echo ""
}

# Run the fix script
run_fixes() {
    print_status "Running Railway fixes..."
    
    if [ -f "fix_railway_issues.js" ]; then
        node fix_railway_issues.js
        print_success "Railway fixes applied"
    else
        print_warning "Fix script not found, skipping..."
    fi
    echo ""
}

# Test WhatsApp configuration
test_whatsapp() {
    print_status "Testing WhatsApp configuration..."
    
    if [ -f "test_whatsapp_railway.js" ]; then
        node test_whatsapp_railway.js
        print_success "WhatsApp test completed"
    else
        print_warning "WhatsApp test script not found, skipping..."
    fi
    echo ""
}

# Deploy to Railway
deploy_to_railway() {
    print_status "Deploying to Railway..."
    
    # Check if project is initialized
    if [ ! -f "railway.json" ]; then
        print_status "Initializing Railway project..."
        railway init
    fi
    
    # Deploy with Docker builder
    print_status "Building and deploying with Docker..."
    railway up --build-builder dockerfile
    
    print_success "Deployment completed!"
    echo ""
}

# Show deployment URL
show_deployment_info() {
    print_status "Getting deployment information..."
    
    echo ""
    print_success "Deployment completed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Configure environment variables in Railway dashboard"
    echo "2. Test the health endpoint: https://your-app.railway.app/health"
    echo "3. Test WhatsApp OTP functionality"
    echo ""
    echo "Useful commands:"
    echo "- View logs: railway logs --tail"
    echo "- Open dashboard: railway open"
    echo "- Check status: railway status"
    echo ""
}

# Main deployment process
main() {
    echo "Starting deployment process..."
    echo ""
    
    # Step 1: Check prerequisites
    check_railway_cli
    check_railway_login
    
    # Step 2: Apply fixes
    run_fixes
    
    # Step 3: Test configuration
    test_whatsapp
    
    # Step 4: Deploy
    deploy_to_railway
    
    # Step 5: Show information
    show_deployment_info
}

# Handle script arguments
case "${1:-}" in
    "fix")
        print_status "Running fixes only..."
        run_fixes
        ;;
    "test")
        print_status "Running tests only..."
        test_whatsapp
        ;;
    "deploy")
        print_status "Deploying only..."
        deploy_to_railway
        show_deployment_info
        ;;
    "help"|"-h"|"--help")
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  fix     - Run Railway fixes only"
        echo "  test    - Test WhatsApp configuration only"
        echo "  deploy  - Deploy to Railway only"
        echo "  help    - Show this help message"
        echo ""
        echo "If no command is provided, runs the full deployment process."
        exit 0
        ;;
    "")
        main
        ;;
    *)
        print_error "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac
