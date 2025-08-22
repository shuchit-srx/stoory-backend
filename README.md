# Stoory Backend - Automated Bid Flow System

## 🎯 Overview

This is the backend implementation for Stoory, featuring a complete automated bid flow system that handles conversations from bid application to payment initiation. The system is built with clean architecture, proper separation of concerns, and production-ready code.

## 🚀 Features

### **Automated Bid Flow System**
- **Dynamic conversation flow** with state management
- **Automated message generation** with context-aware content
- **Action-based interactions** (buttons, input fields, confirmations)
- **Role-based access control** (brand owners, influencers, admins)
- **Real-time flow state tracking**
- **Payment integration ready**

### **Core System**
- **User authentication** with JWT tokens
- **Role-based permissions** (brand_owner, influencer, admin)
- **Bid management** (create, read, update, delete)
- **Campaign management** with automated flows
- **Payment system integration**
- **Real-time messaging** via WebSocket

## 🏗️ Architecture

### **Clean Separation**
- **Service Layer**: Business logic in dedicated services
- **Controller Layer**: HTTP request handling and validation
- **Route Layer**: API endpoint definitions
- **Database Layer**: Supabase with PostgreSQL
- **Utility Layer**: Reusable helper functions

### **Key Components**
- `utils/automatedFlowService.js` - Core automated flow logic
- `controllers/bidController.js` - Bid and automated flow endpoints
- `routes/bids.js` - API route definitions
- `database/` - Schema and migration files

## 📡 API Endpoints

### **Automated Flow Endpoints**
```
POST /api/bids/automated/initialize          - Start automated conversation
POST /api/bids/automated/brand-owner-action  - Handle brand owner actions
POST /api/bids/automated/influencer-action   - Handle influencer actions
POST /api/bids/automated/final-confirmation  - Final confirmation
GET  /api/bids/automated/conversation/:id/context - Get flow context
```

### **Standard Bid Endpoints**
```
POST   /api/bids                    - Create new bid
GET    /api/bids                    - Get all bids
GET    /api/bids/:id                - Get specific bid
PUT    /api/bids/:id                - Update bid
DELETE /api/bids/:id                - Delete bid
GET    /api/bids/stats              - Get bid statistics
```

## 🗄️ Database Schema

### **Key Tables**
- `users` - User accounts and roles
- `bids` - Bid information and requirements
- `conversations` - Automated flow conversations
- `messages` - Automated and user messages
- `requests` - Bid applications and connections

### **Automated Flow Fields**
- `flow_state` - Current conversation state
- `awaiting_role` - Whose turn to respond
- `flow_data` - JSON data for flow context
- `action_required` - Whether message requires action
- `action_data` - UI elements (buttons, inputs)

## 🚀 Getting Started

### **Prerequisites**
- Node.js 16+
- PostgreSQL database
- Supabase account

### **Installation**
```bash
# Clone repository
git clone <repository-url>
cd stoory-backend

# Install dependencies
npm install

# Set up environment variables
cp env.example .env
# Edit .env with your configuration

# Run database migrations
# Execute database/add_automation_fields.sql
# Execute database/add_automated_message_fields.sql

# Start development server
npm run dev
```

### **Environment Variables**
```bash
# Database
DATABASE_URL=your_database_url
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key

# Authentication
JWT_SECRET=your_jwt_secret
PORT=3000
```

## 🧪 Testing

### **Automated Flow Testing**
The system includes comprehensive testing for:
- Message generation
- Action creation
- Flow state transitions
- Role-based access control
- Error handling

### **API Testing**
Use the provided API documentation to test all endpoints:
- `AUTOMATED_FLOW_API_DOCUMENTATION.md` - Complete API reference
- `FRONTEND_AUTOMATED_FLOW_INTEGRATION.md` - Frontend integration guide

## 📚 Documentation

### **Core Documentation**
- `IMPLEMENTATION_COMPLETE_SUMMARY.md` - Complete system overview
- `BID_AUTOMATED_FLOW_GUIDE.md` - Business logic documentation
- `AUTOMATED_FLOW_API_DOCUMENTATION.md` - API reference
- `FRONTEND_AUTOMATED_FLOW_INTEGRATION.md` - Frontend guide

### **Database Migrations**
- `database/add_automation_fields.sql` - Add automation fields to conversations
- `database/add_automated_message_fields.sql` - Add action fields to messages

## 🔄 Flow States

### **Complete Flow**
```
initial → influencer_responding → brand_owner_confirming → payment_pending
    ↓              ↓                      ↓
negotiating → influencer_responding → brand_owner_confirming
    ↓              ↓                      ↓
question_pending → influencer_responding → brand_owner_confirming
```

### **State Descriptions**
- `initial` - Brand owner sees action buttons
- `influencer_responding` - Influencer confirms/rejects
- `negotiating` - Price or question negotiation
- `brand_owner_confirming` - Final confirmation
- `payment_pending` - Payment initiation

## 🛡️ Security

### **Authentication & Authorization**
- JWT token-based authentication
- Role-based access control
- Ownership verification for all actions
- Flow state validation

### **Data Protection**
- Input validation and sanitization
- SQL injection prevention
- XSS protection
- Rate limiting ready

## 🚀 Deployment

### **Railway Deployment**
```bash
# Deploy to Railway
npm run deploy:railway
```

### **Docker Deployment**
```bash
# Build and run with Docker
docker build -t stoory-backend .
docker run -p 3000:3000 stoory-backend
```

## 🔧 Development

### **Available Scripts**
```bash
npm run dev          # Start development server
npm start            # Start production server
npm run nodemon      # Start with nodemon
```

### **Code Structure**
```
├── controllers/     # Request handlers
├── routes/         # API route definitions
├── utils/          # Business logic services
├── database/       # Schema and migrations
├── middleware/     # Authentication and validation
├── sockets/        # WebSocket handling
└── supabase/       # Database client
```

## 🤝 Contributing

1. Follow the existing code structure
2. Add proper error handling
3. Include input validation
4. Update documentation
5. Test all changes

## 📄 License

This project is proprietary software for Stoory.

## 🆘 Support

For questions or issues, refer to the documentation files or contact the development team.

---

**🚀 Ready for production deployment with automated bid flow system!** 