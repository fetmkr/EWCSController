// 간단한 검증 함수들

export function validateOnOff(req, res, next) {
  const { on } = req.query;
  if (!['0', '1'].includes(on)) {
    return res.status(400).json({ error: 'Invalid value for "on"' });
  }
  next();
}

export function validateNumber(min, max) {
  return (req, res, next) => {
    const value = parseInt(req.query.value);
    if (isNaN(value) || value < min || value > max) {
      return res.status(400).json({ error: `Value must be between ${min} and ${max}` });
    }
    next();
  };
}

export function validateString(minLength, maxLength) {
  return (req, res, next) => {
    const { value } = req.query;
    if (value && typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length < minLength) {
        return res.status(400).json({ error: `String must be at least ${minLength} characters` });
      }
      // maxLength는 체크하지 않음 (자동으로 자르기 때문)
    }
    next();
  };
}