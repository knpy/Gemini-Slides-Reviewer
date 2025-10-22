const GEMINI_MODEL = "gemini-2.5-pro";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const CONFIG_URL = chrome.runtime.getURL("src/config/runtimeConfig.json");

const DEFAULT_PROMPTS = [
  {
    id: "clarity-audit",
    label: "明確性と読みやすさ",
    prompt:
      "このスライドの明確性、可読性、ビジュアルがメッセージをサポートしているかをレビューしてください。わかりにくい表現、専門用語、文脈不足を指摘し、各ビジュアルがテキストを明確に補強しているかを説明してください。具体的な改善提案をしてください。"
  },
  {
    id: "structure-check",
    label: "構成とストーリー",
    prompt:
      "スライドの構成を段階的に評価してください。各スライドの目的が明確か、遷移が自然か、論理的なストーリー展開があるかを確認してください。順序がおかしい、または冗長なスライドを指摘し、より引き締まった流れを提案してください。"
  },
  {
    id: "visual-contrast",
    label: "視認性とアクセシビリティ",
    prompt:
      "テキストの可読性とビジュアルのアクセシビリティを評価してください。コントラストが低いテキスト、詰め込まれたレイアウト、説明が不足しているビジュアルを探してください。デザイン意図を保ちながらアクセシビリティを向上させる改善を推奨してください。"
  },
  {
    id: "holistic-review",
    label: "全体のストーリーと整合性",
    prompt:
      "プレゼンテーション全体を通して、ストーリーの一貫性と論理的な流れを評価してください。各スライドが全体の文脈の中でどのような役割を果たしているかを分析し、スライド間の整合性、メッセージの一貫性、ストーリーの展開を確認してください。全体として改善すべき点を具体的に提案してください。"
  }
];

const STORAGE_KEYS = {
  PROMPTS: "geminiCustomPrompts",
  API_KEY: "geminiApiKey",
  LAST_PROMPT_ID: "geminiLastPromptId"
};

let runtimeConfig = {
  defaultApiKey: ""
};

const runtimeConfigPromise = loadRuntimeConfig();

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "GEMINI_TOGGLE_PANEL" });
  } catch (err) {
    // When the content script has not been injected because the page
    // does not match, ignore quietly. This keeps the extension from
    // throwing noisy errors when the icon is clicked on other pages.
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GEMINI_RUN_CHECK") {
    (async () => {
      try {
        const result = await runGeminiCheckStreaming(message.payload, sender.tab?.id);
        sendResponse({ ok: true, result });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    })();
    return true;
  }

  if (message?.type === "GEMINI_RUN_CHECK_PDF") {
    (async () => {
      try {
        const result = await runGeminiCheckWithPDF(message.payload, sender.tab?.id);
        sendResponse({ ok: true, result });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    })();
    return true;
  }

  if (message?.type === "CAPTURE_SCREENSHOT") {
    (async () => {
      try {
        console.log('[Background] Capturing screenshot with rect:', message.rect);
        // Capture the visible tab
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        console.log('[Background] Full screenshot captured:', dataUrl ? `${dataUrl.substring(0, 50)}...` : 'null');

        // Crop the image to the specified rectangle
        const croppedDataUrl = await cropImage(dataUrl, message.rect);
        console.log('[Background] Cropped screenshot:', croppedDataUrl ? `${croppedDataUrl.substring(0, 50)}...` : 'null');
        sendResponse(croppedDataUrl);
      } catch (error) {
        console.error('[Background] Screenshot capture failed:', error);
        sendResponse(null);
      }
    })();
    return true;
  }

  // Phase 6: キックオフURLからテキストを抽出
  if (message?.type === "EXTRACT_FROM_KICKOFF_URL") {
    (async () => {
      try {
        console.log('[Background] Extracting from kickoff URL:', message.url);
        const extractedText = await extractTextFromUrl(message.url);
        sendResponse({ ok: true, text: extractedText });
      } catch (error) {
        console.error('[Background] Failed to extract from URL:', error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    })();
    return true;
  }

  // Phase 6: Gemini APIでコンテキストを抽出
  if (message?.type === "GEMINI_EXTRACT_CONTEXT") {
    (async () => {
      try {
        console.log('[Background] Extracting context with Gemini API');
        const result = await runGeminiExtractContext(message.prompt);
        sendResponse({ ok: true, result });
      } catch (error) {
        console.error('[Background] Failed to extract context:', error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    })();
    return true;
  }

  return undefined;
});

async function ensureDefaults() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.PROMPTS);
  if (!stored?.[STORAGE_KEYS.PROMPTS]) {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.PROMPTS]: DEFAULT_PROMPTS
    });
  }
}

async function resolveApiKey() {
  await runtimeConfigPromise;
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.API_KEY);
  const key = stored?.[STORAGE_KEYS.API_KEY]?.trim();
  if (key) {
    return key;
  }
  const fallback = runtimeConfig?.defaultApiKey?.trim?.();
  if (fallback) {
    return fallback;
  }
  throw new Error(
    "Gemini API key is not set. Add it in the extension options (chrome://extensions > Details > Extension options)."
  );
}

async function runGeminiCheckWithPDF(payload, tabId) {
  const apiKey = await resolveApiKey();
  if (!payload?.prompt || !payload?.pdfData) {
    throw new Error("Request missing prompt or PDF data.");
  }

  const userPrompt = payload.prompt.trim();
  const slideCount = payload.slideCount || 0;

  // Build enhanced prompt for PDF analysis
  const enhancedPrompt = `以下の${slideCount}枚のスライドを含むプレゼンテーションPDFを分析してください。各スライドを確認した上で、以下の指示に従ってください：\n\n${userPrompt}`;

  // Extract base64 data from data URL
  const base64Data = payload.pdfData.split(',')[1];
  if (!base64Data) {
    throw new Error("Invalid PDF data URL format.");
  }

  console.log(`[Gemini API] Sending PDF with ${slideCount} slides to Gemini Vision`);

  const parts = [
    { text: enhancedPrompt },
    {
      inline_data: {
        mime_type: "application/pdf",
        data: base64Data
      }
    }
  ];

  const streamEndpoint = GEMINI_ENDPOINT.replace(':generateContent', ':streamGenerateContent');
  const response = await fetch(`${streamEndpoint}?key=${encodeURIComponent(apiKey)}&alt=sse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: parts
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API responded with ${response.status}: ${errorBody}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim().startsWith('data: '));

      for (const line of lines) {
        const jsonStr = line.replace('data: ', '');
        if (jsonStr.trim() === '[DONE]') continue;

        try {
          const data = JSON.parse(jsonStr);
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullText += text;
            // Send streaming update to content script
            if (tabId) {
              chrome.tabs.sendMessage(tabId, {
                type: "GEMINI_STREAM_CHUNK",
                chunk: text,
                fullText: fullText
              }).catch(() => {
                // Ignore errors if content script is not ready
              });
            }
          }
        } catch (parseError) {
          console.warn("Failed to parse SSE chunk:", parseError);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!fullText) {
    throw new Error("Gemini API returned an empty response.");
  }

  return {
    text: fullText,
    model: GEMINI_MODEL,
    timestamp: Date.now()
  };
}

async function runGeminiCheckStreaming(payload, tabId) {
  const apiKey = await resolveApiKey();
  if (!payload?.prompt || !payload?.presentationSummary) {
    throw new Error("Request missing prompt or presentation data.");
  }

  const userPrompt = payload.prompt.trim();

  // Build the parts array
  const parts = [{ text: userPrompt }];

  // Add all screenshots (for multi-slide analysis)
  const slides = payload.presentationSummary.slides || [];
  let screenshotCount = 0;

  slides.forEach((slide, index) => {
    const screenshot = slide?.screenshot;
    if (screenshot && typeof screenshot === 'string' && screenshot.includes(',')) {
      const base64Data = screenshot.split(',')[1];
      if (base64Data) {
        parts.push({
          inline_data: {
            mime_type: "image/png",
            data: base64Data
          }
        });
        screenshotCount++;
      }
    }
  });

  if (screenshotCount > 0) {
    console.log(`[Gemini API] Sending ${screenshotCount} screenshot(s) to Gemini Vision`);
  } else {
    console.warn('[Gemini API] No valid screenshots available');
  }

  const streamEndpoint = GEMINI_ENDPOINT.replace(':generateContent', ':streamGenerateContent');
  const response = await fetch(`${streamEndpoint}?key=${encodeURIComponent(apiKey)}&alt=sse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: parts
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API responded with ${response.status}: ${errorBody}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim().startsWith('data: '));

      for (const line of lines) {
        const jsonStr = line.replace('data: ', '');
        if (jsonStr.trim() === '[DONE]') continue;

        try {
          const data = JSON.parse(jsonStr);
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullText += text;
            // Send streaming update to content script
            if (tabId) {
              chrome.tabs.sendMessage(tabId, {
                type: "GEMINI_STREAM_CHUNK",
                chunk: text,
                fullText: fullText
              }).catch(() => {
                // Ignore errors if content script is not ready
              });
            }
          }
        } catch (parseError) {
          console.warn("Failed to parse SSE chunk:", parseError);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!fullText) {
    throw new Error("Gemini API returned an empty response.");
  }

  return {
    text: fullText,
    model: GEMINI_MODEL,
    timestamp: Date.now()
  };
}

function formatPresentationData(presentationSummary) {
  const lines = [];
  presentationSummary.slides.forEach((slide, index) => {
    lines.push(`Slide ${index + 1}: ${slide.title || "(no title)"}`);
    if (slide.textBlocks?.length) {
      slide.textBlocks.forEach((text, idx) => {
        lines.push(`  Text ${idx + 1}: ${collapseWhitespace(text)}`);
      });
    }
    if (slide.visuals?.length) {
      slide.visuals.forEach((visual, idx) => {
        const description = visual.description
          ? collapseWhitespace(visual.description)
          : "No description available.";
        lines.push(`  Visual ${idx + 1}: ${description}`);
      });
    }
    if (slide.notes) {
      lines.push(`  Speaker notes: ${collapseWhitespace(slide.notes)}`);
    }
  });

  return lines.join("\n");
}

function collapseWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

async function cropImage(dataUrl, rect) {
  return new Promise((resolve, reject) => {
    try {
      console.log('[cropImage] Starting crop with rect:', rect);
      const img = new Image();

      img.onerror = (error) => {
        console.error('[cropImage] Image load error:', error);
        reject(error);
      };

      img.onload = () => {
        console.log('[cropImage] Image loaded, dimensions:', img.width, 'x', img.height);
        try {
          const canvas = new OffscreenCanvas(rect.width, rect.height);
          const ctx = canvas.getContext('2d');

          // Draw the cropped portion
          ctx.drawImage(
            img,
            rect.x, rect.y, rect.width, rect.height,
            0, 0, rect.width, rect.height
          );

          console.log('[cropImage] Image drawn to canvas');

          // Convert to data URL
          canvas.convertToBlob({ type: 'image/png' }).then(blob => {
            console.log('[cropImage] Blob created, size:', blob.size);
            const reader = new FileReader();
            reader.onloadend = () => {
              console.log('[cropImage] Conversion complete');
              resolve(reader.result);
            };
            reader.onerror = (error) => {
              console.error('[cropImage] FileReader error:', error);
              reject(error);
            };
            reader.readAsDataURL(blob);
          }).catch(error => {
            console.error('[cropImage] Blob conversion error:', error);
            reject(error);
          });
        } catch (error) {
          console.error('[cropImage] Canvas operation error:', error);
          reject(error);
        }
      };

      img.src = dataUrl;
    } catch (error) {
      console.error('[cropImage] General error:', error);
      reject(error);
    }
  });
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch(CONFIG_URL);
    if (response.ok) {
      runtimeConfig = await response.json();
    }
  } catch (error) {
    // Non-blocking: fall back to empty config.
    console.warn("Gemini Slides Reviewer: Failed to load runtime config.", error);
  }
}

/**
 * Phase 6: Gemini APIでコンテキストを抽出（非ストリーミング）
 */
async function runGeminiExtractContext(prompt) {
  const apiKey = await resolveApiKey();
  if (!prompt) {
    throw new Error("Prompt is required");
  }

  console.log('[Gemini API] Extracting context with prompt');

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API responded with ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Gemini API returned an empty response.");
  }

  return {
    text: text,
    model: GEMINI_MODEL,
    timestamp: Date.now()
  };
}

/**
 * Phase 6: URLからテキストを抽出
 * Google SlidesのURLを開いて、スライドのテキストコンテンツを抽出します
 */
async function extractTextFromUrl(url) {
  console.log('[Phase 6] Opening URL in background tab:', url);

  // 新しいタブを作成（非表示）
  const tab = await chrome.tabs.create({
    url: url,
    active: false
  });

  console.log('[Phase 6] Tab created:', tab.id);

  // タブが完全に読み込まれるまで待つ
  await waitForTabLoad(tab.id);

  console.log('[Phase 6] Tab loaded, waiting for slides to render...');

  // スライドがレンダリングされるまで少し待つ
  await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    // コンテンツスクリプトを注入してテキストを抽出
    console.log('[Phase 6] Injecting extraction script...');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractSlidesText
    });

    console.log('[Phase 6] Extraction complete:', results);

    // タブを閉じる
    await chrome.tabs.remove(tab.id);

    if (results && results[0] && results[0].result) {
      return results[0].result;
    } else {
      throw new Error('テキストの抽出に失敗しました');
    }
  } catch (error) {
    // エラーが発生した場合もタブを閉じる
    try {
      await chrome.tabs.remove(tab.id);
    } catch (closeError) {
      console.warn('[Phase 6] Failed to close tab:', closeError);
    }
    throw error;
  }
}

/**
 * Phase 6: タブの読み込み完了を待つ
 */
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('タブの読み込みがタイムアウトしました'));
    }, 30000); // 30秒でタイムアウト

    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Phase 6: Google Slidesからテキストを抽出する関数（タブ内で実行される）
 * この関数はタブのコンテキストで実行されます
 */
function extractSlidesText() {
  console.log('[Extract] Starting text extraction from Google Slides...');

  try {
    // Google Slidesのテキスト要素を探す
    const textElements = [];

    // スライドのタイトルを取得
    const titleElement = document.querySelector('title');
    if (titleElement) {
      textElements.push(`タイトル: ${titleElement.textContent}`);
    }

    // すべてのテキストコンテンツを取得
    // Google Slidesは様々な要素でテキストを表示するため、複数のセレクタを試す
    const selectors = [
      '.docs-text-paragraph',
      '.docs-text',
      '[role="textbox"]',
      '.sketchy-text-content-wrapper',
      '.sketchy-text-content'
    ];

    const foundTexts = new Set(); // 重複を避けるためにSetを使用

    selectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        const text = el.textContent?.trim();
        if (text && text.length > 0) {
          foundTexts.add(text);
        }
      });
    });

    // 見つかったテキストを配列に変換
    textElements.push(...Array.from(foundTexts));

    console.log('[Extract] Found', textElements.length, 'text elements');

    if (textElements.length === 0) {
      return 'テキストが見つかりませんでした。スライドが読み込まれているか確認してください。';
    }

    return textElements.join('\n\n');
  } catch (error) {
    console.error('[Extract] Extraction error:', error);
    return `エラー: ${error.message}`;
  }
}
