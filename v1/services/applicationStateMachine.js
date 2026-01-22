const transitions = {
    APPLIED: ['ACCEPTED', 'CANCELLED'],
    ACCEPTED: ['SCRIPT', 'WORK', 'CANCELLED'], // Can transition to SCRIPT or WORK after payment
    SCRIPT: ['WORK', 'CANCELLED'], // After script approval, move to WORK
    WORK: ['PAYOUT', 'CANCELLED'], // When work is accepted, move to PAYOUT
    PAYOUT: ['COMPLETED'], // When admin releases payout, move to COMPLETED
    COMPLETED: [],
    CANCELLED: []
  };
  
  exports.canTransition = (from, to) =>
    transitions[from]?.includes(to);