const express = require('express');
const router = express.Router();

// Number calling patterns and sequences
const callingPatterns = {
  standard: {
    name: 'Standard Random',
    description: 'Completely random number calling',
    algorithm: 'random'
  },
  balanced: {
    name: 'Balanced Distribution',
    description: 'Ensures even distribution across BINGO letters',
    algorithm: 'balanced'
  },
  sequential: {
    name: 'Sequential',
    description: 'Calls numbers in sequence',
    algorithm: 'sequential'
  },
  hot_cold: {
    name: 'Hot/Cold Numbers',
    description: 'Tracks frequently and infrequently called numbers',
    algorithm: 'hot_cold'
  }
};

// GET /api/numbers/patterns - Get all calling patterns
router.get('/patterns', (req, res) => {
  res.json({
    success: true,
    data: callingPatterns,
    count: Object.keys(callingPatterns).length,
    stage: 'Stage 4 - Number Calling'
  });
});

// GET /api/numbers/patterns/:patternId - Get specific pattern
router.get('/patterns/:patternId', (req, res) => {
  const pattern = callingPatterns[req.params.patternId];
  if (!pattern) {
    return res.status(404).json({
      success: false,
      error: 'Pattern not found'
    });
  }
  res.json({
    success: true,
    data: pattern
  });
});

// POST /api/numbers/generate-sequence - Generate a number sequence
router.post('/generate-sequence', (req, res) => {
  const { pattern = 'standard', count = 75, exclude = [] } = req.body;
  
  const generateSequence = (pattern, count, exclude) => {
    const numbers = [];
    const excluded = new Set(exclude);
    
    switch (pattern) {
      case 'sequential':
        for (let i = 1; i <= count; i++) {
          if (!excluded.has(i)) {
            numbers.push(i);
          }
        }
        break;
        
      case 'balanced':
        const ranges = [
          { min: 1, max: 15 },    // B
          { min: 16, max: 30 },   // I
          { min: 31, max: 45 },   // N
          { min: 46, max: 60 },   // G
          { min: 61, max: 75 }    // O
        ];
        
        for (const range of ranges) {
          for (let i = range.min; i <= range.max; i++) {
            if (!excluded.has(i)) {
              numbers.push(i);
            }
          }
        }
        // Shuffle the balanced array
        for (let i = numbers.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
        }
        break;
        
      case 'hot_cold':
        // Simulate hot/cold tracking (in real implementation, would use historical data)
        const hotNumbers = [7, 14, 23, 42, 68];
        const coldNumbers = [3, 19, 37, 51, 72];
        
        // Add hot numbers first
        for (const num of hotNumbers) {
          if (!excluded.has(num) && numbers.length < count) {
            numbers.push(num);
          }
        }
        
        // Add remaining numbers randomly
        for (let i = 1; i <= 75; i++) {
          if (!excluded.has(i) && !hotNumbers.includes(i) && !coldNumbers.includes(i)) {
            numbers.push(i);
          }
        }
        
        // Add cold numbers at the end
        for (const num of coldNumbers) {
          if (!excluded.has(num) && numbers.length < count) {
            numbers.push(num);
          }
        }
        break;
        
      default: // standard
        for (let i = 1; i <= 75; i++) {
          if (!excluded.has(i)) {
            numbers.push(i);
          }
        }
        // Shuffle
        for (let i = numbers.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
        }
    }
    
    return numbers.slice(0, count);
  };
  
  const sequence = generateSequence(pattern, count, exclude);
  
  // Add letter information
  const sequenceWithLetters = sequence.map(num => {
    let letter;
    if (num <= 15) letter = 'B';
    else if (num <= 30) letter = 'I';
    else if (num <= 45) letter = 'N';
    else if (num <= 60) letter = 'G';
    else letter = 'O';
    
    return { number: num, letter };
  });
  
  res.json({
    success: true,
    data: {
      pattern,
      sequence: sequenceWithLetters,
      count: sequenceWithLetters.length,
      excluded: exclude,
      generatedAt: new Date().toISOString()
    },
    message: 'Number sequence generated successfully'
  });
});

// GET /api/numbers/statistics - Get number calling statistics
router.get('/statistics', (req, res) => {
  // Mock statistics (in real implementation, would come from database)
  const statistics = {
    totalCalls: 1250,
    averageCallsPerGame: 45.2,
    mostCalledNumbers: [
      { number: 23, timesCalled: 45, percentage: 3.6 },
      { number: 7, timesCalled: 42, percentage: 3.4 },
      { number: 14, timesCalled: 40, percentage: 3.2 }
    ],
    leastCalledNumbers: [
      { number: 75, timesCalled: 15, percentage: 1.2 },
      { number: 1, timesCalled: 18, percentage: 1.4 },
      { number: 37, timesCalled: 20, percentage: 1.6 }
    ],
    letterDistribution: {
      B: { called: 625, percentage: 25.0 },
      I: { called: 630, percentage: 25.2 },
      N: { called: 620, percentage: 24.8 },
      G: { called: 635, percentage: 25.4 },
      O: { called: 640, percentage: 25.6 }
    },
    averageGameDuration: 1800, // seconds
    averageCallInterval: 4.5 // seconds
  };
  
  res.json({
    success: true,
    data: statistics
  });
});

// POST /api/numbers/validate - Validate a number call
router.post('/validate', (req, res) => {
  const { number, calledNumbers, pattern } = req.body;
  
  if (!number || !Array.isArray(calledNumbers)) {
    return res.status(400).json({
      success: false,
      error: 'Number and calledNumbers array are required'
    });
  }
  
  const validation = {
    isValid: true,
    errors: [],
    warnings: []
  };
  
  // Check if number is within valid range
  if (number < 1 || number > 75) {
    validation.isValid = false;
    validation.errors.push('Number must be between 1 and 75');
  }
  
  // Check if number has already been called
  if (calledNumbers.includes(number)) {
    validation.isValid = false;
    validation.errors.push(`Number ${number} has already been called`);
  }
  
  // Check if we've called all numbers
  if (calledNumbers.length >= 75) {
    validation.isValid = false;
    validation.errors.push('All numbers have been called');
  }
  
  // Pattern-specific validation
  if (pattern === 'balanced') {
    const letterCounts = {
      B: calledNumbers.filter(n => n <= 15).length,
      I: calledNumbers.filter(n => n > 15 && n <= 30).length,
      N: calledNumbers.filter(n => n > 30 && n <= 45).length,
      G: calledNumbers.filter(n => n > 45 && n <= 60).length,
      O: calledNumbers.filter(n => n > 60).length
    };
    
    const maxCount = Math.max(...Object.values(letterCounts));
    const minCount = Math.min(...Object.values(letterCounts));
    
    if (maxCount - minCount > 3) {
      validation.warnings.push('Letter distribution is unbalanced');
    }
  }
  
  res.json({
    success: true,
    data: validation,
    message: validation.isValid ? 'Number is valid to call' : 'Number validation failed'
  });
});

module.exports = router;
