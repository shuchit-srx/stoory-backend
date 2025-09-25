# Corrected Negotiation Flow

## 🎯 **Fixed Negotiation Flow**

### **❌ Previous (Wrong) Flow:**
```
1. Influencer clicks "Negotiate" → brand_owner_negotiation
2. Brand owner clicks "Agree" → negotiation_input ❌ WRONG
3. Brand owner enters price → influencer_final_response
```

### **✅ Corrected Flow:**
```
1. Influencer clicks "Negotiate" → brand_owner_negotiation
2. Brand owner clicks "Agree" → influencer_price_response ✅ CORRECT
3. Influencer sets counter price → brand_owner_price_response
4. Brand owner accepts/rejects/makes final offer → influencer_final_response
```

## 🔄 **Complete Negotiation Flow States**

### **1. Initial Price Offer**
- **State:** `influencer_price_response`
- **Awaiting:** `influencer`
- **Actions:** Accept, Reject, Negotiate

### **2. Negotiation Request**
- **State:** `brand_owner_negotiation`
- **Awaiting:** `brand_owner`
- **Actions:** Agree to Negotiate, Reject Negotiation

### **3. Counter Offer (Influencer Sets Price)**
- **State:** `influencer_price_response`
- **Awaiting:** `influencer`
- **Actions:** Send Counter Offer

### **4. Brand Owner Response to Counter Offer**
- **State:** `brand_owner_price_response`
- **Awaiting:** `brand_owner`
- **Actions:** Accept Counter Offer, Reject Counter Offer, Make Final Offer

### **5. Final Decision (Influencer)**
- **State:** `influencer_final_response`
- **Awaiting:** `influencer`
- **Actions:** Accept Final Offer, Reject Final Offer

## 🎮 **Detailed Flow Examples**

### **Example 1: Successful Negotiation**
```
1. influencer_price_response (awaiting: influencer)
   ↓ Influencer clicks "Negotiate Price"
2. brand_owner_negotiation (awaiting: brand_owner)
   ↓ Brand owner clicks "Agree to Negotiate"
3. influencer_price_response (awaiting: influencer)
   ↓ Influencer enters counter price and clicks "Send Counter Offer"
4. brand_owner_price_response (awaiting: brand_owner)
   ↓ Brand owner clicks "Accept Counter Offer"
5. payment_pending (awaiting: brand_owner)
```

### **Example 2: Rejected Negotiation**
```
1. influencer_price_response (awaiting: influencer)
   ↓ Influencer clicks "Negotiate Price"
2. brand_owner_negotiation (awaiting: brand_owner)
   ↓ Brand owner clicks "Reject Negotiation"
3. chat_closed (awaiting: null)
```

### **Example 3: Final Offer Flow**
```
1. influencer_price_response (awaiting: influencer)
   ↓ Influencer clicks "Negotiate Price"
2. brand_owner_negotiation (awaiting: brand_owner)
   ↓ Brand owner clicks "Agree to Negotiate"
3. influencer_price_response (awaiting: influencer)
   ↓ Influencer enters counter price and clicks "Send Counter Offer"
4. brand_owner_price_response (awaiting: brand_owner)
   ↓ Brand owner clicks "Make Final Offer"
5. influencer_final_response (awaiting: influencer)
   ↓ Influencer clicks "Accept Final Offer"
6. payment_pending (awaiting: brand_owner)
```

## 🎯 **Button Mappings**

### **Brand Owner Buttons:**
```javascript
'agree_negotiation' → handle_negotiation (action: 'agree')
'reject_negotiation' → handle_negotiation (action: 'reject')
'accept_counter_offer' → accept_counter_offer
'reject_counter_offer' → reject_counter_offer
'make_final_offer' → make_final_offer
'proceed_to_payment' → proceed_to_payment
```

### **Influencer Buttons:**
```javascript
'negotiate_price' → negotiate_price
'send_counter_offer' → send_counter_offer
'accept_final_offer' → accept_final_offer
'reject_final_offer' → reject_final_offer
'accept_price' → accept_price
'reject_price' → reject_price
```

## 🔧 **Key Changes Made**

### **1. Fixed Brand Owner "Agree to Negotiate"**
- **Before:** `negotiation_input` (Brand owner enters price)
- **After:** `influencer_price_response` (Influencer sets counter price)

### **2. Added Counter Offer Flow**
- **New State:** `brand_owner_price_response`
- **New Action:** `send_counter_offer`
- **New Buttons:** Accept/Reject/Make Final Offer

### **3. Added Final Offer Flow**
- **New State:** `influencer_final_response`
- **New Actions:** `accept_final_offer`, `reject_final_offer`
- **New Buttons:** Accept Final Offer, Reject Final Offer

### **4. Enhanced Button Mappings**
- Added all new button IDs to the button click handler
- Proper action mapping for both brand owner and influencer
- Data passing for price information

## 🎯 **Flow State Transitions**

### **Negotiation Flow:**
```
influencer_price_response → negotiate_price → brand_owner_negotiation
brand_owner_negotiation → agree_negotiation → influencer_price_response
influencer_price_response → send_counter_offer → brand_owner_price_response
brand_owner_price_response → accept_counter_offer → payment_pending
brand_owner_price_response → reject_counter_offer → chat_closed
brand_owner_price_response → make_final_offer → influencer_final_response
influencer_final_response → accept_final_offer → payment_pending
influencer_final_response → reject_final_offer → chat_closed
```

## 🚀 **Current Status**

### **✅ What's Working:**
- ✅ **Correct flow state transitions**
- ✅ **Proper awaiting role management**
- ✅ **Counter offer handling**
- ✅ **Final offer handling**
- ✅ **Button click routing**
- ✅ **Debug logging**

### **🎯 Key Features:**
- ✅ **Influencer sets counter price** (not brand owner)
- ✅ **Brand owner responds to counter offers**
- ✅ **Final offer mechanism**
- ✅ **Proper state management**
- ✅ **Multi-round negotiations**

## 🎉 **The negotiation flow is now correctly implemented!**

The flow now properly follows the intended sequence:
1. **Influencer negotiates** → Brand owner agrees
2. **Influencer sets counter price** → Brand owner responds
3. **Brand owner can accept, reject, or make final offer**
4. **Final decision by influencer** → Payment or chat closed

This matches your requirements perfectly! 🚀
