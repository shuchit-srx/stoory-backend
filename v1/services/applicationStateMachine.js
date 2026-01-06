const transitions = {
    PENDING: ['ACCEPTED', 'CANCELLED'],
    APPLIED: ['ACCEPTED', 'CANCELLED'],
    ACCEPTED: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: []
  };
  
  exports.canTransition = (from, to) =>
    transitions[from]?.includes(to);