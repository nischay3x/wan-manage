const { RateLimiterMemory } = require('rate-limiter-flexible');

class EventsLimiter {
  constructor (
    counts,
    duration,
    blockDuration,
    onRelease = async () => {},
    onBlock = async () => {},
    alreadyBlocked = async () => {}
  ) {
    this.maxCount = counts;
    this.limiter = new RateLimiterMemory({
      points: counts,
      duration: duration,
      blockDuration: blockDuration
    });
    this.blockedLimiter = new RateLimiterMemory({
      points: counts,
      duration: duration,
      blockDuration: blockDuration
    });
    this.onReleaseCallback = onRelease;
    this.onBlockCallback = onBlock;
    this.onAlreadyBlockedCallback = alreadyBlocked;
  }

  async use (key, ...callbacksArgs) {
    let res = true;
    try {
      res = await this.limiter.consume(key);
    } catch (err) {
      this.blockedLimiter.consume(key);
      res = false;
      // blocked now
      if (err.consumedPoints === this.maxCount + 1) {
        await this.onBlockCallback(...callbacksArgs);
      }

      // already blocked
      if (err.consumedPoints > this.maxCount + 1) {
        await this.onAlreadyBlockedCallback(...callbacksArgs);
      }
    }

    if (res && res.consumedPoints === 1) {
      await this.onReleaseCallback(...callbacksArgs);
    }

    return res;
  }

  async release (key, releaseCallback = null) {
    const isBlocked = await this.isBlocked(key);
    if (!isBlocked) {
      return false;
    }

    const isDeleted = await this.limiter.delete(key);
    if (!isDeleted) {
      return false;
    }

    // check if override release callback passed
    if (releaseCallback) {
      await releaseCallback();
    } else {
      await this.onReleaseCallback();
    }
    return true;
  }

  async isBlocked (key) {
    const res = await this.limiter.get(key);
    if (!res) return false;
    return res && res.consumedPoints > this.maxCount + 1;
  }
};

module.exports = EventsLimiter;
