// ==UserScript==
// @name         X Content Filter
// @version      1.17
// @updateURL    https://omba.nl/files/x-ai-filter/x-ai-filter-userscript.js
// @downloadURL  https://omba.nl/files/x-ai-filter/x-ai-filter-userscript.js
// @description  Analyzes and filters content on X.com based on configured topics
// @match        https://x.com/*
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// ==/UserScript==

(function() {
    'use strict';

    const topicsConfig = [
        {"topic": "politics", "description": "posts about political subjects", "threshold": 0.8},
        {"topic": "negativity", "description": "posts with overly negative sentiment", "threshold": 0.9}
    ];

    let hiddenPostsCount = 0;
    let hiddenPostsLog = [];

    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'hiddenPostsOverlay';
        overlay.style.cssText = 'position:fixed;top:0;right:0;z-index:9999;';
        document.body.appendChild(overlay);

        const bubble = document.createElement('div');
        bubble.style.cssText = 'font-family:sans-serif;background:#1DA1F2;color:#fff;border-radius:3px;padding:5px 8px;cursor:pointer;margin:5px;';
        bubble.onclick = toggleLog;
        overlay.appendChild(bubble);

        const log = document.createElement('div');
        log.style.cssText = 'font-family:sans-serif;display:none;background:#fff;border:1px solid #000;padding:10px;max-height:300px;overflow-y:auto;color:black;';
        overlay.appendChild(log);

        return { bubble, log };
    }

    const { bubble, log } = createOverlay();

    function toggleLog() {
        log.style.display = log.style.display === 'none' ? 'block' : 'none';
    }

    function updateOverlay(message) {
        hiddenPostsCount++;
        hiddenPostsLog.push(message);
        bubble.textContent = hiddenPostsCount;
        log.innerHTML = hiddenPostsLog.join('<br><br>');
    }

    async function checkForNewPosts() {
        const apiKey = await getGroqApiKey();
        if (!apiKey) {
            console.error("No API key provided. Aborting analysis.");
            return;
        }

        const posts = document.querySelectorAll('[data-testid="cellInnerDiv"]');

        posts.forEach(async post => {
            const tweetArticle = post.querySelector('article[data-testid="tweet"]');
            if (!tweetArticle) return;

            const postId = Array.from(tweetArticle.querySelectorAll('a'))
                .find(a => a.href.includes('/status/'))
                ?.href.split('/')
                .find((part, index, array) => array[index - 1] === 'status');
            const postTextElement = tweetArticle.querySelector('[data-testid="tweetText"]');
            const postText = postTextElement ? postTextElement.innerText.trim() : '';

            if (postId) {
                let analysis = await getCachedAnalysis(postId);
                if (!analysis) {
                    analysis = await analyzeTweet(postText, apiKey);
                    await cacheAnalysis(postId, analysis);
                }
                applyPostVisibility(postId, analysis, post);
            }
        });
    }

    async function getCachedAnalysis(postId) {
        return GM.getValue(`analysis_${postId}`, null);
    }

    async function cacheAnalysis(postId, analysis) {
        await GM.setValue(`analysis_${postId}`, analysis);
    }

    function applyPostVisibility(postId, analysis, postElement) {
        if (typeof analysis === 'object' && analysis !== null) {
            const shouldHide = topicsConfig.some(topic => 
                topic.topic in analysis && analysis[topic.topic] > topic.threshold
            );

            if (shouldHide) {
                if (postElement.style.display !== 'none') {
                    postElement.style.display = 'none';
                    const tweetUrl = `https://x.com/user/status/${postId}`;
                    const tweetText = postElement.querySelector('[data-testid="tweetText"]')?.innerText.trim() || 'Text not found';
                    const scores = topicsConfig.map(topic => `${topic.topic}: ${analysis[topic.topic].toFixed(2)}`).join(', ');
                    const message = `Post ${postId} hidden: ${tweetUrl}\n${tweetText}\nScores: ${scores}`;
                    updateOverlay(message);
                }
            }
        }
    }

    async function analyzeTweet(tweetText, apiKey) {
        let retries = 0;
        const maxRetries = 3;
        const messages = [
            {
                role: "system",
                content: `Your task is to evaluate Tweets/X posts. Always respond in JSON. Follow this format:\n\n{\n${topicsConfig.map(topic => `    "${topic.topic}": 0.0`).join(',\n')}\n}\n\nRate the provided post from 0.0 to 1.0 for each topic. Here are the descriptions for each topic:\n\n${topicsConfig.map(topic => `${topic.topic}: ${topic.description}`).join('\n')}`
            },
            {
                role: "user",
                content: tweetText
            }
        ];

        while (retries < maxRetries) {
            try {
                const response = await new Promise((resolve, reject) => {
                    GM.xmlHttpRequest({
                        method: "POST",
                        url: "https://api.groq.com/openai/v1/chat/completions",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${apiKey}`
                        },
                        data: JSON.stringify({
                            messages: messages,
                            model: "llama-3.1-8b-instant",
                            temperature: 1,
                            max_tokens: 1024,
                            top_p: 1,
                            stream: false,
                            response_format: {
                                type: "json_object"
                            },
                            stop: null
                        }),
                        onload: resolve,
                        onerror: reject
                    });
                });

                if (response.status === 400) {
                    retries++;
                    continue;
                }

                const data = JSON.parse(response.responseText);
                return JSON.parse(data.choices[0].message.content);
            } catch (error) {
                retries++;
                if (retries === maxRetries) {
                    console.error("Max retries reached. Returning empty object.");
                    return {};
                }
            }
        }

        return {};
    }

    async function getGroqApiKey() {
        let apiKey = await GM.getValue('GROQ_API_KEY', null);
        if (!apiKey) {
            apiKey = prompt("Please enter your Groq API key:");
            if (apiKey) {
                await GM.setValue('GROQ_API_KEY', apiKey);
            }
        }
        return apiKey;
    }

    function debounce(func, delay) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }

    const debouncedCheck = debounce(checkForNewPosts, 300);

    window.addEventListener('scroll', () => {
        if (window.location.hostname === 'x.com') {
            debouncedCheck();
        }
    });

    if (window.location.hostname === 'x.com') {
        checkForNewPosts();
    }

})();
