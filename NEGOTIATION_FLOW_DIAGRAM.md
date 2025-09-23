# Negotiation Flow Diagram

This document contains visual diagrams showing the complete negotiation flow implementation.

## 🔄 Complete Negotiation Flow

```mermaid
graph TD
    A[Initial Price Set] --> B{Influencer Response}
    B -->|Accept| C[Payment Pending]
    B -->|Negotiate| D[Brand Owner Negotiation]
    B -->|Reject| E[Chat Closed]
    
    D --> F{Brand Owner Decision}
    F -->|Agree to Negotiate| G[Price Input Form]
    F -->|Reject Negotiation| E
    
    G --> H[Send Negotiated Price]
    H --> I{Influencer Final Response}
    
    I -->|Accept| C
    I -->|Reject| E
    I -->|Continue Negotiating| J{Negotiation Limit Check}
    
    J -->|Within Limit| K[Counter Offer Input]
    J -->|Limit Reached| L[Final Offer Only]
    
    K --> M[Send Counter Offer]
    M --> N{Brand Owner Response}
    N -->|Accept| C
    N -->|Reject| E
    N -->|Make New Offer| H
    
    L --> O{Influencer Final Decision}
    O -->|Accept| C
    O -->|Reject| E
    
    C --> P[Payment Completed]
    P --> Q[Work In Progress]
    Q --> R[Work Submitted]
    R --> S[Work Approved]
    S --> T[Real-time Chat Enabled]
    
    style A fill:#e1f5fe
    style C fill:#c8e6c9
    style E fill:#ffcdd2
    style T fill:#f3e5f5
```

## 🎯 Negotiation States Detail

```mermaid
stateDiagram-v2
    [*] --> influencer_price_response : Initial price set
    
    influencer_price_response --> brand_owner_negotiation : negotiate_price
    influencer_price_response --> payment_pending : accept_price
    influencer_price_response --> chat_closed : reject_price
    
    brand_owner_negotiation --> negotiation_input : agree_negotiation
    brand_owner_negotiation --> chat_closed : reject_negotiation
    
    negotiation_input --> influencer_final_response : send_negotiated_price
    
    influencer_final_response --> payment_pending : accept_negotiated_price
    influencer_final_response --> chat_closed : reject_negotiated_price
    influencer_final_response --> brand_owner_pricing : continue_negotiate
    
    brand_owner_pricing --> influencer_price_response : send_price_offer
    
    payment_pending --> payment_completed : payment_success
    payment_completed --> work_in_progress : start_work
    work_in_progress --> work_submitted : submit_work
    work_submitted --> work_approved : approve_work
    work_approved --> real_time : enable_chat
    
    chat_closed --> [*]
    real_time --> [*]
```

## 🔄 Multi-Round Negotiation Flow

```mermaid
sequenceDiagram
    participant I as Influencer
    participant S as System
    participant B as Brand Owner
    
    Note over I,B: Round 1: Initial Negotiation
    
    B->>S: Set initial price (₹3000)
    S->>I: Show price with options
    I->>S: Counter offer (₹5000)
    S->>B: Show negotiation request
    
    Note over I,B: Round 2: Brand Owner Response
    
    B->>S: Agree to negotiate
    S->>B: Show price input form
    B->>S: Send new offer (₹4000)
    S->>I: Show final response options
    
    Note over I,B: Round 3: Final Decision
    
    I->>S: Continue negotiating (₹4500)
    S->>B: Show counter offer
    B->>S: Accept counter offer
    S->>I: Price accepted - proceed to payment
    
    Note over I,B: Payment & Work Flow
    
    B->>S: Complete payment
    S->>I: Payment confirmed - start work
    I->>S: Submit completed work
    S->>B: Work ready for review
    B->>S: Approve work
    S->>I,B: Real-time chat enabled
```

## 🎨 UI Component Flow

```mermaid
graph LR
    A[Price Message] --> B{Action Required?}
    B -->|Yes| C[Action Component]
    B -->|No| D[Text Message]
    
    C --> E{Component Type}
    E -->|negotiation_request| F[Negotiation Request UI]
    E -->|price_input| G[Price Input Form]
    E -->|final_response| H[Final Response UI]
    E -->|counter_offer| I[Counter Offer UI]
    
    F --> J[Action Buttons]
    G --> K[Input Field + Submit]
    H --> L[Accept/Reject Buttons]
    I --> M[Price Display + Actions]
    
    J --> N[Button Click Handler]
    K --> O[Text Input Handler]
    L --> N
    M --> N
    
    N --> P[API Call]
    O --> P
    P --> Q[WebSocket Event]
    Q --> R[State Update]
    R --> S[UI Re-render]
```

## 📱 Mobile UI Flow

```mermaid
graph TD
    A[Mobile Screen] --> B{Screen Size}
    B -->|Small| C[Stacked Layout]
    B -->|Large| D[Side-by-side Layout]
    
    C --> E[Full-width Buttons]
    C --> F[Vertical Input Form]
    C --> G[Scrollable History]
    
    D --> H[Two-column Layout]
    D --> I[Inline Input Fields]
    D --> J[Sidebar History]
    
    E --> K[Touch-friendly Sizing]
    F --> K
    G --> L[Pull-to-refresh]
    H --> M[Responsive Grid]
    I --> N[Auto-focus Input]
    J --> O[Collapsible Sections]
    
    K --> P[Accessibility Features]
    L --> P
    M --> P
    N --> P
    O --> P
```

## 🔧 Error Handling Flow

```mermaid
graph TD
    A[User Action] --> B[Validation]
    B -->|Valid| C[API Call]
    B -->|Invalid| D[Show Error Message]
    
    C --> E{API Response}
    E -->|Success| F[Update State]
    E -->|Error| G[Handle Error]
    
    G --> H{Error Type}
    H -->|Network| I[Retry with Backoff]
    H -->|Validation| J[Show Field Error]
    H -->|Server| K[Show Server Error]
    H -->|Auth| L[Redirect to Login]
    
    I --> M{Retry Count}
    M -->|< Max| C
    M -->|>= Max| N[Show Network Error]
    
    F --> O[Update UI]
    D --> P[Clear on Next Action]
    J --> P
    K --> P
    L --> Q[Auth Flow]
    N --> R[Manual Retry]
    
    O --> S[Success Notification]
    P --> T[User Feedback]
    Q --> U[Re-authenticate]
    R --> A
```

## 📊 State Management Flow

```mermaid
graph LR
    A[User Action] --> B[Action Creator]
    B --> C[Reducer]
    C --> D[State Update]
    D --> E[Component Re-render]
    
    F[WebSocket Event] --> G[Event Handler]
    G --> H[Action Dispatch]
    H --> C
    
    I[API Response] --> J[Response Handler]
    J --> K[Success/Error Action]
    K --> C
    
    L[Local Storage] --> M[Persistence Layer]
    M --> N[State Hydration]
    N --> D
    
    O[Error Boundary] --> P[Error State]
    P --> Q[Fallback UI]
    Q --> R[Recovery Action]
    R --> A
```

## 🧪 Testing Flow

```mermaid
graph TD
    A[Test Suite] --> B[Unit Tests]
    A --> C[Integration Tests]
    A --> D[E2E Tests]
    
    B --> E[Component Tests]
    B --> F[Reducer Tests]
    B --> G[Utility Tests]
    
    C --> H[API Integration]
    C --> I[WebSocket Integration]
    C --> J[State Management]
    
    D --> K[User Workflows]
    D --> L[Cross-browser]
    D --> M[Mobile Testing]
    
    E --> N[Render Tests]
    E --> O[Interaction Tests]
    E --> P[Props Tests]
    
    H --> Q[Mock API Calls]
    I --> R[Mock WebSocket]
    J --> S[Mock State]
    
    K --> T[Full Negotiation Flow]
    L --> U[Browser Compatibility]
    M --> V[Touch Interactions]
```

---

These diagrams provide a comprehensive visual representation of the negotiation flow implementation, covering all aspects from user interactions to technical implementation details.
