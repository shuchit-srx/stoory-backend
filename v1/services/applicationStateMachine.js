const transitions = {
    APPLIED: ['ACCEPTED', 'CANCELLED'],
    ACCEPTED: ['SCRIPT', 'WORK', 'CANCELLED'], // Can transition to SCRIPT or WORK after payment
    SCRIPT: ['WORK', 'COMPLETED', 'CANCELLED'], // After script approval, move to WORK
    WORK: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: []
  };
  
  exports.canTransition = (from, to) =>
    transitions[from]?.includes(to);