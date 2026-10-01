// Reviews management - stored in localStorage
const reviews = (() => {
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { } }
  };

  return {
    // Get all reviews for a product
    getProductReviews(productId) {
      const all = store.get('productReviews', {});
      return (all[productId] || []).sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    // Get single review
    getReview(productId, reviewId) {
      const all = store.get('productReviews', {});
      return (all[productId] || []).find(r => r.id === reviewId);
    },

    // Add review
    addReview(productId, review) {
      const all = store.get('productReviews', {});
      if (!all[productId]) all[productId] = [];

      const newReview = {
        id: 'review_' + Date.now(),
        productId,
        rating: review.rating,
        title: review.title,
        text: review.text,
        author: review.author,
        email: review.email,
        date: new Date().toISOString(),
        verified: false,
        approved: true // Auto-approve for demo
      };

      all[productId].push(newReview);
      store.set('productReviews', all);
      return newReview;
    },

    // Update review
    updateReview(productId, reviewId, updates) {
      const all = store.get('productReviews', {});
      const idx = (all[productId] || []).findIndex(r => r.id === reviewId);
      if (idx >= 0) {
        all[productId][idx] = { ...all[productId][idx], ...updates };
        store.set('productReviews', all);
        return all[productId][idx];
      }
      return null;
    },

    // Delete review
    deleteReview(productId, reviewId) {
      const all = store.get('productReviews', {});
      if (all[productId]) {
        all[productId] = all[productId].filter(r => r.id !== reviewId);
        store.set('productReviews', all);
      }
    },

    // Get average rating for product
    getAverageRating(productId) {
      const productReviews = this.getProductReviews(productId);
      if (!productReviews.length) return 0;
      const sum = productReviews.reduce((s, r) => s + r.rating, 0);
      return Math.round(sum / productReviews.length * 10) / 10;
    },

    // Get rating distribution
    getRatingDistribution(productId) {
      const productReviews = this.getProductReviews(productId);
      const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      productReviews.forEach(r => {
        if (dist.hasOwnProperty(r.rating)) dist[r.rating]++;
      });
      return dist;
    },

    // Get all reviews (for admin)
    getAllReviews() {
      const all = store.get('productReviews', {});
      const reviews = [];
      for (const productId in all) {
        reviews.push(...all[productId].map(r => ({ ...r, productId })));
      }
      return reviews.sort((a, b) => new Date(b.date) - new Date(a.date));
    },

    // Check if user can review
    canUserReview(productId) {
      const user = store.get('currentUser', null);
      return !!user;
    },

    // Check if user already reviewed
    userHasReviewed(productId) {
      const user = store.get('currentUser', null);
      if (!user) return false;
      const productReviews = this.getProductReviews(productId);
      return productReviews.some(r => r.email === user.email);
    }
  };
})();
