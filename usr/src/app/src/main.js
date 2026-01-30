// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/)
import { Actor } from 'apify';
// Crawlee - web scraping and browser automation library (Read more at https://crawlee.dev)
import { CheerioCrawler, Dataset } from 'crawlee';

// The init() call configures the Actor for its environment. It's recommended to start every Actor with an init()
await Actor.init();

// Structure of input is defined in input_schema.json
const { startUrls = ['https://www.congress.gov/search?q=%7B%22search%22:%5B%22trade%22%5D%7D'], maxRequestsPerCrawl = 200 } = (await Actor.getInput()) ?? {};

// Proxy configuration to rotate IP addresses and prevent blocking (https://docs.apify.com/platform/proxy)
const proxyConfiguration = await Actor.createProxyConfiguration();

const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxRequestsPerCrawl,
    async requestHandler({ enqueueLinks, request, $, log }) {
        const url = request.loadedUrl ?? request.url;
        log.info('Processing', { url });

        // Enqueue likely detail pages: bills, member disclosures, press releases, committee pages
        await enqueueLinks({
            globs: ['**/bill/**', '**/member/**', '**/press-release/**', '**/committees/**', '**/search**'],
        });

        // Heuristic extraction for common page types:
        // - congress.gov bill / record pages: title in h1, date in .result-item .date or time elements
        // - member sites / press releases: h1/h2 and date elements
        try {
            // Generic title
            const title = $('h1').first().text().trim() || $('title').text().trim();

            // Date heuristics: look for time or date meta tags
            let date = $('time').first().attr('datetime') || $('meta[name="DC.date"]')?.attr('content') || $('meta[property="article:published_time"]')?.attr('content') || '';
            if (!date) {
                const dateText = $('span.date, .result-item .date, .display-date, .publication-date').first().text().trim();
                date = dateText || date;
            }

            // Type heuristics (bill, press release, disclosure, hearing)
            let type = '';
            if (url.includes('/bill/') || url.includes('/bills/')) type = 'bill';
            else if (url.toLowerCase().includes('press') || url.toLowerCase().includes('press-release')) type = 'press_release';
            else if (url.toLowerCase().includes('disclosure') || url.toLowerCase().includes('financial')) type = 'disclosure';
            else if ($('meta[property="og:type"]').attr('content')) type = $('meta[property="og:type"]').attr('content');

            // Summary extraction: try meta description, then first paragraphs
            let summary = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
            if (!summary) {
                const p = $('p').first().text().trim();
                summary = p || summary;
            }

            // Save only if meaningful content is present
            if (title || summary) {
                await Dataset.pushData({
                    title: title || '',
                    date: date || '',
                    type: type || '',
                    summary: summary || '',
                    url,
                });
                log.info('Saved item', { title, url });
            } else {
                log.debug('No meaningful title/summary found', { url });
            }
        } catch (err) {
            log.warning('Extraction error', { url, message: err.message });
        }
    },
});

await crawler.run(startUrls);

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit()
await Actor.exit();
