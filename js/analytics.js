/**
 * analytics.js - Page view and click tracking
 */

const TRACK_URL = 'https://tracker-g00j.onrender.com/api/track/click';

function buildContextPayload() {
    const params = new URLSearchParams(window.location.search);
    const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

    const filters = {};
    for (const [key, value] of params.entries()) {
        if (!utmKeys.includes(key)) {
            filters[key] = value;
        }
    }

    let referrerDomain = null;
    if (document.referrer) {
        try {
            referrerDomain = new URL(document.referrer).hostname;
        } catch {
            // Invalid referrer URL, leave as null
        }
    }

    return {
        filters: Object.keys(filters).length > 0 ? filters : null,
        referrer: document.referrer || null,
        referrer_domain: referrerDomain,
        utm_source: params.get('utm_source') || null,
        utm_medium: params.get('utm_medium') || null,
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
        screen_w: window.screen.width,
        screen_h: window.screen.height,
        device_pixel_ratio: window.devicePixelRatio || 1,
        url_at_click: window.location.href,
        user_agent: navigator.userAgent.slice(0, 512),
        ts: new Date().toISOString()
    };
}

function post(payload) {
    fetch(TRACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
    });
}

/**
 * Track a page view
 */
export function trackPageView() {
    if (window.location.hostname !== 'smckissock.github.io') return;

    try {
        post({
            app_id: 2,
            article_url: null,
            article_position: null,
            ...buildContextPayload()
        });
    } catch (e) {
        console.warn('Page view tracking failed:', e);
    }
}

/**
 * Track a click on a story link
 * @param {string} url - URL that was clicked
 */
export function trackClick(url) {
    if (window.location.hostname !== 'smckissock.github.io') return;

    try {
        post({
            app_id: 2,
            article_url: url,
            article_position: null,
            ...buildContextPayload()
        });
    } catch (e) {
        console.warn('Click tracking failed:', e);
    }
}
