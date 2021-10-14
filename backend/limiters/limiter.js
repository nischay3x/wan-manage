const { RateLimiterMemory } = require('rate-limiter-flexible');

class FwLimiter {
  constructor (counts, duration, blockDuration) {
    this.maxCount = counts;
    this.duration = duration;
    this.blockDuration = blockDuration;

    // Main limiter for a key
    this.limiter = new RateLimiterMemory({
      points: counts,
      duration: duration,
      blockDuration: blockDuration
    });

    // Secondary limiter use to counting how many times the key consumed
    // *after* it blocked by the main limiter.
    // if secondary limiter is become blocked, it means that the high rate is still a problem.
    // In this case, we blocked manually the main limiter for another period of time
    // and reset the secondary limiter to 0.
    // Then it starts to count again how many times, the blocked key is consumed.
    this.secondaryLimiter = new RateLimiterMemory({
      points: counts,
      // secondary limiter window time should be a bit more
      // to make sure it's not expires before the main limiter
      duration: duration * 2,
      blockDuration: blockDuration
    });
  }

  async use (key) {
    const response = { allowed: true, blockedNow: false, releasedNow: false };
    try {
      // try to consume a point. If blocked, an error will be thrown.
      const res = await this.limiter.consume(key);

      // if not blocked, delete the secondary if exists for this key.
      await this.secondaryLimiter.delete(key);

      // currently, it is not possible to pass a callback that is automatically
      // executed when the key expires.
      // So we call the release function on the next allowed time.
      if (res.consumedPoints === 1) {
        response.releasedNow = true;
      }
    } catch (err) {
      // at this point, the main limiter is blocked.
      response.allowed = false;

      // only the first time a block is obtained for this key - call the block callback
      if (err.consumedPoints === this.maxCount + 1) {
        response.blockedNow = true;
      }

      // only the first time a block is obtained for this key - call the block callback
      if (err.remainingPoints <= 0) {
        try {
          await this.secondaryLimiter.consume(key);
        } catch (secRes) {
          // if secondary limiter is blocked, block the main limiter and delete the internal
          await this.limiter.block(key, this.blockDuration * 2);
          await this.secondaryLimiter.set(key, 0, this.duration);
        }
      }
    }

    return response;
  }

  async delete (key) {
    await this.secondaryLimiter.delete(key);
    return this.limiter.delete(key);
  }

  async release (key) {
    const isBlocked = await this.isBlocked(key);
    if (!isBlocked) {
      return false;
    }

    const isDeleted = await this.delete(key);
    if (!isDeleted) {
      return false;
    }

    // release the secondary limiter as well;
    await this.secondaryLimiter.delete(key);

    return true;
  }

  async isSecondaryBlocked (key) {
    const secondaryRes = await this.secondaryLimiter.get(key);
    if (secondaryRes && secondaryRes.remainingPoints < 0) {
      return true;
    } else {
      return false;
    }
  }

  async isBlocked (key) {
    const res = await this.limiter.get(key);
    const isSecondaryBlocked = await this.isSecondaryBlocked(key);

    if (res !== null && res.remainingPoints < 0) {
      return true;
    }

    if (isSecondaryBlocked) {
      return true;
    }

    return false;
  }
};

module.exports = FwLimiter;
