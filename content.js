// Configuration object for topics
const topicsConfig = [
    {"topic": "politics", "description": "posts about political subjects", "threshold": 0.8},
    {"topic": "negativity", "description": "posts with overly negative sentiment", "threshold": 0.9}
];

// Function to check for new posts on the page
function checkForNewPosts() {
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
                analysis = await analyzeTweet(postText);
                await cacheAnalysis(postId, analysis);
            }
            applyPostVisibility(postId, analysis);
        }
    });
}

// Function to get cached analysis
async function getCachedAnalysis(postId) {
    return new Promise((resolve) => {
        chrome.storage.local.get([`analysis_${postId}`], result => {
            resolve(result[`analysis_${postId}`] || null);
        });
    });
}

// Function to cache analysis
async function cacheAnalysis(postId, analysis) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [`analysis_${postId}`]: analysis }, resolve);
    });
}

// Function to apply post visibility based on analysis
function applyPostVisibility(postId, analysis) {
    if (typeof analysis === 'object' && analysis !== null) {
        const shouldHide = topicsConfig.some(topic => 
            topic.topic in analysis && analysis[topic.topic] > topic.threshold
        );

        if (shouldHide) {
            const postElement = findPostElement(postId);
            if (postElement) {
                if (postElement.style.display !== 'none') {
                    postElement.style.display = 'none';
                    const tweetUrl = `https://x.com/user/status/${postId}`;
                    const tweetText = postElement.querySelector('[data-testid="tweetText"]')?.innerText.trim() || 'Text not found';
                    console.log(`Post ${postId} hidden due to high scores:`);
                    topicsConfig.forEach(topic => {
                        if (topic.topic in analysis) {
                            console.log(`${topic.topic}: ${analysis[topic.topic]}`);
                        }
                    });
                    console.log(`Tweet URL: ${tweetUrl}`);
                    console.log(`Tweet Text: ${tweetText}`);
                }
            } else {
                console.log(`Could not find element for post ${postId} to hide`);
            }
        }
    } else {
        console.log(`Skipping post ${postId} due to invalid analysis result`);
    }
}

// Function to find the div element containing a specific post ID
function findPostElement(postId) {
    if (typeof postId !== 'string') {
        throw new Error('postId must be a string');
    }
    const cellInnerDivs = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    
    for (const div of cellInnerDivs) {
        const link = div.querySelector(`a[href*="/status/${postId}"]`);
        if (link) {
            return div;
        }
    }
    
    return null; // Return null if no matching element is found
}
window.findPostElement = findPostElement;

// Function to reset the cache (seenPostIds and analysis results)
function resetCache() {
    chrome.storage.local.get(null, (items) => {
        const allKeys = Object.keys(items);
        const analysisKeys = allKeys.filter(key => key.startsWith('analysis_'));
        chrome.storage.local.remove(analysisKeys, () => {
            console.log('Cache (analysis results) has been reset.');
        });
    });
}

// Make resetCache function available in the global scope
window.resetCache = resetCache;

console.log('To reset the cache, run resetCache() in the console.');

// Function to analyze a tweet using the Groq API
async function analyzeTweet(tweetText) {
    let apiKey = await getGroqApiKey();
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
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
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
                })
            });

            if (response.status === 400) {
                retries++;
                continue;
            }

            const data = await response.json();
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

// Function to get or set the Groq API key
async function getGroqApiKey() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['GROQ_API_KEY'], result => {
            if (result.GROQ_API_KEY) {
                resolve(result.GROQ_API_KEY);
            } else {
                const apiKey = prompt("Please enter your Groq API key:");
                chrome.storage.local.set({ GROQ_API_KEY: apiKey }, () => {
                    resolve(apiKey);
                });
            }
        });
    });
}

// Debounce function to limit how often the scroll event fires
function debounce(func, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

// Create debounced version of checkForNewPosts
const debouncedCheck = debounce(checkForNewPosts, 300);

// Modify the scroll event listener to call checkForNewPosts
window.addEventListener('scroll', () => {
    if (window.location.hostname === 'x.com') {
        debouncedCheck();
    }
});

// Initial check when the page loads
if (window.location.hostname === 'x.com') {
    checkForNewPosts();
}