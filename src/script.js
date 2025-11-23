document.addEventListener("DOMContentLoaded", () => {
  // --- DOM Element References ---
  const moduleList = document.getElementById("module-list");
  const contentTitle = document.getElementById("content-title");
  const authorReviewerInfo = document.getElementById("author-reviewer-info");
  const contentBody = document.getElementById("content-body");

  // Search-related DOM elements
  const searchInput = document.getElementById("search-input");
  const searchResultsDiv = document.getElementById("search-results");
  const mainNav = document.getElementById("main-nav");
  const moduleFilter = document.getElementById("module-filter");
  const contentArea = document.querySelector(".content-area");



  // --- Data Storage ---
  let allModulesData = []; // To store the fetched modules.json data (nested structure)
  // Optimized for search: moduleId -> { id, title, author, reviewer, contentPath, parentModuleId, keywords }
  let flattenedModulesForSearch = {};
  // New: Store full profile data from authors.json + authored/reviewed content lists
  let allAuthorsReviewers = {}; // Stores name -> { ..., authoredContent: [], reviewedContent: [] }
  // Language keywords data
  let languageKeywords = {}; // Stores language -> { declaration, control, loops, etc. }
  // Color configuration data
  let keywordColors = {}; // Stores category -> hex color

  // --- Helper Function: Flatten Modules for Keyword Search and Collect Author/Reviewer Names ---
  function flattenModulesForKeywordSearch(modules) {
    const flattened = {};
    // Only collect names here; detailed profiles come from authors.json
    const uniquePeopleNames = new Set();

    modules.forEach((module) => {
      // Process parent module
      if (module.contentPath) {
        const moduleEntry = {
          id: module.id,
          title: module.name,
          author: module.author || "N/A",
          reviewer: module.reviewer || "N/A",
          contentPath: module.contentPath,
          parentModuleId: module.id, // Parent module's ID is its own ID
          keywords: (module.keywords || []).map((k) => k.toLowerCase()),
        };
        flattened[module.id] = moduleEntry;

        if (module.author && module.author !== "N/A")
          uniquePeopleNames.add(module.author);
        if (module.reviewer && module.reviewer !== "N/A")
          uniquePeopleNames.add(module.reviewer);
      }

      // Process children
      if (module.children) {
        module.children.forEach((child) => {
          if (child.contentPath) {
            const childEntry = {
              id: child.id,
              title: child.name,
              author: child.author || module.author || "N/A", // Inherit from parent if not specified
              reviewer: child.reviewer || module.reviewer || "N/A", // Inherit from parent if not specified
              contentPath: child.contentPath,
              parentModuleId: module.id, // Associate child with its parent module ID
              keywords: (child.keywords || []).map((k) => k.toLowerCase()),
            };
            flattened[child.id] = childEntry;

            if (childEntry.author && childEntry.author !== "N/A")
              uniquePeopleNames.add(childEntry.author);
            if (childEntry.reviewer && childEntry.reviewer !== "N/A")
              uniquePeopleNames.add(childEntry.reviewer);
          }
        });
      }
    });

    // Now, go through the flattened modules to populate authored/reviewed content lists
    // This must happen AFTER allAuthorsReviewers is loaded from authors.json
    // So, this part will be moved out and called separately after both JSONs are loaded.
    return flattened;
  }

  // --- Function: Load Keywords (from keywords.json) ---
  async function loadKeywords() {
    try {
      const response = await fetch("src/keywords.json");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const keywordsData = await response.json();
      languageKeywords = keywordsData.languages || {};
      keywordColors = keywordsData.colors || {};
      console.log("Keywords data loaded from keywords.json.");
      console.log("Color configuration loaded:", keywordColors);
    } catch (error) {
      console.error("Error loading keywords data:", error);
      // Even if keywords fail, the page can still load without highlighting
    }
  }

  // --- Function: Apply Syntax Highlighting to Code Blocks ---
  function applyCodeHighlighting() {
    const codeBlocks = contentBody.querySelectorAll("code[class*='language-']");

    codeBlocks.forEach((codeBlock) => {
      // Extract language from class (e.g., "language-abap" -> "abap")
      const languageClass = Array.from(codeBlock.classList).find((cls) =>
        cls.startsWith("language-")
      );

      if (!languageClass) return;

      const language = languageClass.replace("language-", "").toLowerCase();
      const langData = languageKeywords[language];

      if (!langData) {
        console.warn(`Language "${language}" not found in keywords.json`);
        return;
      }

      // Collect all keywords for this language
      const allKeywordsForLang = new Set();
      Object.keys(langData).forEach((category) => {
        if (Array.isArray(langData[category])) {
          langData[category].forEach((keyword) => {
            allKeywordsForLang.add(keyword);
          });
        }
      });

      // Process code content
      const text = codeBlock.textContent;
      codeBlock.innerHTML = highlightText(
        text,
        language,
        langData,
        allKeywordsForLang
      );
    });
  }

  // --- Helper: Highlight text based on language and keywords ---
  function highlightText(text, language, langData, allKeywords) {
    const syntax = (langData && langData.syntax) || {};
    const lineComments = Array.isArray(syntax.lineComment)
      ? syntax.lineComment
      : [];
    const blockComments = Array.isArray(syntax.blockComment)
      ? syntax.blockComment
      : [];
    const stringDelims = Array.isArray(syntax.stringDelimiters)
      ? // sort by length desc so triple quotes are matched before single quotes
      syntax.stringDelimiters.slice().sort((a, b) => b.length - a.length)
      : [];
    const stringEscape = syntax.stringEscape || "backslash";

    function getSyntaxColor(kind) {
      // Prefer per-language color overrides if provided (langData.colors)
      if (langData && langData.colors && langData.colors[kind]) {
        return langData.colors[kind];
      }
      if (kind === "comment") return keywordColors["comment"] || "#6b7280";
      if (kind === "string") return keywordColors["string"] || "#059669";
      return keywordColors["default"] || "#6366f1";
    }

    // Helper: process a plain code segment (no comments/strings) for keywords
    function processKeywordsInSegment(segment) {
      if (!segment) return "";
      const escaped = escapeHtml(segment);
      return escaped.replace(/(\b\w+\b)/g, (token) => {
        const isKeyword =
          allKeywords.has(token) ||
          allKeywords.has(token.toUpperCase()) ||
          allKeywords.has(token.toLowerCase());

        if (isKeyword) {
          const keywordType = getKeywordType(token, langData);
          const color = getKeywordColor(keywordType, langData);
          return `<span class="keyword" style="color: ${color}">${escapeHtml(
            token
          )}</span>`;
        }

        return token;
      });
    }

    let i = 0;
    const len = text.length;
    let result = "";

    while (i < len) {
      let matched = false;

      // 1) Block comments (e.g., /* ... */)
      for (const bc of blockComments) {
        if (!bc || !bc.start || !bc.end) continue;
        const start = bc.start;
        const endToken = bc.end;
        if (text.startsWith(start, i)) {
          const endIdx = text.indexOf(endToken, i + start.length);
          const endPos = endIdx === -1 ? len : endIdx + endToken.length;
          const seg = text.slice(i, endPos);
          result += `<span class="comment" style="color: ${getSyntaxColor(
            "comment"
          )}">${escapeHtml(seg)}</span>`;
          i = endPos;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // 2) Line comments (e.g., // ... or -- ... or ")
      for (const lc of lineComments) {
        if (!lc) continue;
        if (text.startsWith(lc, i)) {
          const newlineIdx = text.indexOf("\n", i + lc.length);
          const endPos = newlineIdx === -1 ? len : newlineIdx;
          const seg = text.slice(i, endPos);
          result += `<span class="comment" style="color: ${getSyntaxColor(
            "comment"
          )}">${escapeHtml(seg)}</span>`;
          i = endPos;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // 3) Strings
      for (const delim of stringDelims) {
        if (!delim) continue;
        if (text.startsWith(delim, i)) {
          let j = i + delim.length;
          if (stringEscape === "backslash") {
            while (j < len) {
              if (text[j] === "\\") {
                j += 2; // skip escaped char
                continue;
              }
              if (text.startsWith(delim, j)) {
                j += delim.length;
                break;
              }
              j++;
            }
          } else if (stringEscape === "double") {
            // e.g., ABAP: '' inside a string escapes '\''
            while (j < len) {
              if (text.startsWith(delim + delim, j)) {
                j += delim.length * 2; // skip escaped delimiter sequence
                continue;
              }
              if (text.startsWith(delim, j)) {
                j += delim.length;
                break;
              }
              j++;
            }
          } else {
            // no escape defined: look for next delim occurrence
            const next = text.indexOf(delim, j);
            j = next === -1 ? len : next + delim.length;
          }

          const seg = text.slice(i, j);
          result += `<span class="string" style="color: ${getSyntaxColor(
            "string"
          )}">${escapeHtml(seg)}</span>`;
          i = j;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // 4) Plain code until next special token: gather a chunk and process keywords
      let nextIdx = i + 1;
      while (nextIdx < len) {
        let found = false;
        // check if any special token starts at nextIdx
        for (const bc of blockComments) {
          if (bc && bc.start && text.startsWith(bc.start, nextIdx)) {
            found = true;
            break;
          }
        }
        if (found) break;
        for (const lc of lineComments) {
          if (lc && text.startsWith(lc, nextIdx)) {
            found = true;
            break;
          }
        }
        if (found) break;
        for (const sd of stringDelims) {
          if (sd && text.startsWith(sd, nextIdx)) {
            found = true;
            break;
          }
        }
        if (found) break;
        nextIdx++;
      }

      const plainSeg = text.slice(i, nextIdx);
      result += processKeywordsInSegment(plainSeg);
      i = nextIdx;
    }

    return result;
  }

  // --- Helper: Get color for keyword type ---
  function getKeywordColor(type, langData) {
    // Prefer per-language overrides in langData.colors if present
    if (langData && langData.colors && langData.colors[type]) {
      return langData.colors[type];
    }
    return keywordColors[type] || keywordColors["default"] || "#6366f1";
  }

  // --- Helper: Determine keyword type/category ---
  function getKeywordType(keyword, langData) {
    const upperKeyword = keyword.toUpperCase();
    const lowerKeyword = keyword.toLowerCase();

    for (const [category, keywords] of Object.entries(langData)) {
      if (!Array.isArray(keywords)) continue;

      if (
        keywords.some(
          (kw) => kw === keyword || kw === upperKeyword || kw === lowerKeyword
        )
      ) {
        return category;
      }
    }

    return "default";
  }

  // --- Helper: Get color class for keyword type ---

  // --- Helper: Escape HTML special characters ---
  function escapeHtml(text) {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (char) => map[char]);
  }

  // --- Function: Load Authors (from authors.json) ---
  async function loadAuthors() {
    try {
      const response = await fetch("src/authors.json");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const authorsData = await response.json();
      authorsData.forEach((author) => {
        // Initialize with core profile data, add content lists later
        allAuthorsReviewers[author.name] = {
          ...author,
          authoredContent: [],
          reviewedContent: [],
        };
      });
      console.log("Authors data loaded from authors.json.");
    } catch (error) {
      console.error("Error loading authors data:", error);
      // Even if authors.json fails, modules.json can still load
    }
  }

  // --- Function: Populate Authored/Reviewed Content for Profiles ---
  // This needs to be called AFTER both modules.json and authors.json are loaded
  function populateAuthorReviewerContentLists() {
    Object.values(flattenedModulesForSearch).forEach((module) => {
      if (module.author && allAuthorsReviewers[module.author]) {
        allAuthorsReviewers[module.author].authoredContent.push({
          id: module.id,
          title: module.title,
          parentModuleId: module.parentModuleId,
        });
      }
      if (module.reviewer && allAuthorsReviewers[module.reviewer]) {
        allAuthorsReviewers[module.reviewer].reviewedContent.push({
          id: module.id,
          title: module.title,
          parentModuleId: module.parentModuleId,
        });
      }
    });
    console.log("Author/Reviewer content lists populated.");
    // console.log("Final allAuthorsReviewers:", allAuthorsReviewers); // For debugging
  }

  // --- Function: Load Modules (from modules.json) ---
  async function loadModules() {
    try {
      const response = await fetch("src/modules.json");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      allModulesData = await response.json();

      console.log("Preparing module data for keyword search.");
      flattenedModulesForSearch =
        flattenModulesForKeywordSearch(allModulesData);
      console.log("Module data structure ready for search.");

      renderModules(allModulesData); // Render the navigation list
      populateModuleFilter(allModulesData); // Populate the filter dropdown
    } catch (error) {
      console.error("Error loading modules:", error);
      moduleList.innerHTML =
        '<li class="error-message">Error loading navigation. Please try again.</li>';
    }
  }

  // --- Function: Populate Module Filter Dropdown ---
  function populateModuleFilter(modules) {
    modules.forEach((module) => {
      const option = document.createElement("option");
      option.value = module.id;
      option.textContent = module.name;
      moduleFilter.appendChild(option);
    });
  }

  // --- Function: Render Modules into the DOM ---
  function renderModules(modules) {
    moduleList.innerHTML = "";
    if (!modules || modules.length === 0) {
      moduleList.innerHTML =
        '<li class="no-content-message">No navigation modules available.</li>';
      return;
    }

    modules.forEach((module) => {
      const listItem = document.createElement("li");
      const isParentContentLink = module.contentPath;

      if (module.children && module.children.length > 0) {
        const moduleNameHTML = isParentContentLink
          ? `<a href="#" data-module="${module.id}" class="module-group-link">${module.name}</a>`
          : `<span class="module-group-name">${module.name}</span>`;

        listItem.innerHTML = `
                <div class="module-header" data-module-group="${module.id}">
                  ${moduleNameHTML}
                  <span class="dropdown-toggle-area">
                      <svg class="arrow-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7">
                        </path>
                      </svg>
                  </span>
                </div>
                <ul class="module-submenu"> ${module.children
            .map(
              (child) => `
                  <li>
                    <a href="#" data-module="${child.id}">${child.name}</a>
                  </li>
                `
            )
            .join("")}
                </ul>
              `;
      } else {
        listItem.innerHTML = `
                <a href="#" data-module="${module.id}" class="flat-module-link">${module.name}</a>
              `;
      }
      moduleList.appendChild(listItem);
    });
  }

  // --- Function: Add Copy to Clipboard Buttons to Code Blocks ---
  function addCopyToClipboardButtons() {
    const codeBlocks = contentBody.querySelectorAll("pre");

    codeBlocks.forEach((pre) => {
      if (pre.querySelector(".copy-code-button")) {
        return; // Already has a button
      }

      const button = document.createElement("button");
      button.className = "copy-code-button";
      button.textContent = "Copy";

      button.addEventListener("click", () => {
        const codeElement = pre.querySelector("code");
        let textToCopy = "";

        if (codeElement) {
          textToCopy = codeElement.textContent;
        } else {
          textToCopy = pre.textContent;
          // Fallback: If no <code> tag, try to remove button text
          textToCopy = textToCopy
            .replace(new RegExp(`^${button.textContent}\\s*`), "")
            .trim();
        }

        if (textToCopy.trim() === "") {
          button.textContent = "Empty!";
          button.classList.add("error");
          setTimeout(() => {
            button.textContent = "Copy";
            button.classList.remove("error");
          }, 2000);
          return;
        }

        // Try modern Clipboard API first
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(textToCopy)
            .then(() => {
              button.textContent = "Copied!";
              button.classList.add("copied");
              setTimeout(() => {
                button.textContent = "Copy";
                button.classList.remove("copied");
              }, 2000);
            })
            .catch((err) => {
              console.error("Failed to copy text (Clipboard API error): ", err);
              // Fall back to execCommand approach
              const success = fallbackCopyTextToClipboard(textToCopy);
              if (success) {
                button.textContent = "Copied!";
                button.classList.add("copied");
                setTimeout(() => {
                  button.textContent = "Copy";
                  button.classList.remove("copied");
                }, 2000);
              } else {
                button.textContent = "Error";
                button.classList.add("error");
                setTimeout(() => {
                  button.textContent = "Copy";
                  button.classList.remove("error");
                }, 2000);
              }
            });
        } else {
          // Clipboard API not available — use traditional execCommand fallback
          const success = fallbackCopyTextToClipboard(textToCopy);
          if (success) {
            button.textContent = "Copied!";
            button.classList.add("copied");
            setTimeout(() => {
              button.textContent = "Copy";
              button.classList.remove("copied");
            }, 2000);
          } else {
            button.textContent = "Not supported";
            button.classList.add("error");
            setTimeout(() => {
              button.textContent = "Copy";
              button.classList.remove("error");
            }, 3000);
          }
        }
      });

      pre.appendChild(button);
    });

    // --- Helper: Fallback copy using execCommand (synchronous) ---
    function fallbackCopyTextToClipboard(text) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        // Avoid scrolling to bottom
        textarea.style.position = "fixed";
        textarea.style.top = "0";
        textarea.style.left = "0";
        textarea.style.width = "1px";
        textarea.style.height = "1px";
        textarea.style.padding = "0";
        textarea.style.border = "none";
        textarea.style.outline = "none";
        textarea.style.boxShadow = "none";
        textarea.style.background = "transparent";
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);

        const successful = document.execCommand("copy");
        document.body.removeChild(textarea);
        return successful;
      } catch (err) {
        console.error("Fallback: Oops, unable to copy", err);
        return false;
      }
    }
  }

  // --- Function: Render Author/Reviewer Profile Page ---
  function renderProfilePage(profileName) {
    const profileData = allAuthorsReviewers[profileName];

    if (!profileData) {
      contentTitle.textContent = "Profile Not Found";
      authorReviewerInfo.innerHTML = "";
      contentBody.innerHTML = `<p class="error-message">Profile for "${profileName}" not found or data incomplete.</p>`;
      return;
    }

    contentTitle.textContent = `${profileData.name}'s Profile`;
    authorReviewerInfo.innerHTML = `
      <p><strong>Role:</strong> ${profileData.role || "N/A"}</p>
      ${profileData.contact && profileData.contact.email
        ? `<p><strong>Email:</strong> <a href="mailto:${profileData.contact.email}">${profileData.contact.email}</a></p>`
        : ""
      }
      ${profileData.contact && profileData.contact.linkedin
        ? `<p><strong>LinkedIn:</strong> <a href="${profileData.contact.linkedin}" target="_blank">Connect on LinkedIn</a></p>`
        : ""
      }
      ${profileData.contact && profileData.contact.website
        ? `<p><strong>Website:</strong> <a href="${profileData.contact.website}" target="_blank">${profileData.contact.website}</a></p>`
        : ""
      }
    `;

    let profileImageHtml = profileData.profilePicture
      ? `<img src="${profileData.profilePicture}" alt="${profileData.name}" class="profile-picture">`
      : "";

    let bioHtml = profileData.bio
      ? `<p class="profile-bio">${profileData.bio}</p>`
      : "";

    let authoredHtml = "";
    if (profileData.authoredContent && profileData.authoredContent.length > 0) {
      authoredHtml = `
        <h3>Authored Content:</h3>
        <ul>
          ${profileData.authoredContent
          .map(
            (item) => `
            <li><a href="#" data-module="${item.id}" class="profile-content-link">${item.title}</a></li>
          `
          )
          .join("")}
        </ul>
      `;
    } else {
      authoredHtml = "<p>No content authored.</p>";
    }

    let reviewedHtml = "";
    if (profileData.reviewedContent && profileData.reviewedContent.length > 0) {
      reviewedHtml = `
        <h3>Reviewed Content:</h3>
        <ul>
          ${profileData.reviewedContent
          .map(
            (item) => `
            <li><a href="#" data-module="${item.id}" class="profile-content-link">${item.title}</a></li>
          `
          )
          .join("")}
        </ul>
      `;
    } else {
      reviewedHtml = "<p>No content reviewed.</p>";
    }

    contentBody.innerHTML = `
      <div class="profile-details">
        ${profileImageHtml}
        ${bioHtml}
        ${authoredHtml}
        ${reviewedHtml}
      </div>
    `;

    if (contentArea) {
      contentArea.scrollTop = 0;
    }
  }

  // MHT parsing logic removed. Only HTML files are supported.

  // --- Function: Load Content into Main Area (now handles profiles) ---
  /*async function loadContent(identifier) {
    contentTitle.textContent = "Loading...";
    authorReviewerInfo.innerHTML = "";
    contentBody.innerHTML = "<p>Please wait while content is loaded...</p>";

    if (identifier.startsWith("profile_")) {
      const encodedProfileName = identifier.substring("profile_".length);
      const profileName = decodeURIComponent(encodedProfileName);
      renderProfilePage(profileName);
      return;
    }

    let moduleInfo = null;

    if (flattenedModulesForSearch[identifier]) {
      moduleInfo = flattenedModulesForSearch[identifier];
    } else if (identifier === "Welcome") {
      moduleInfo = {
        id: "Welcome",
        title: "Welcome to SAP Documentation",
        author: "Documentation Team",
        reviewer: "Lead Architect",
        contentPath: "src/content/Welcome.html",
      };
    }

    if (!moduleInfo || !moduleInfo.contentPath) {
      contentTitle.textContent = "Content Not Found";
      authorReviewerInfo.innerHTML = "";
      contentBody.innerHTML =
        '<p class="error-message">The documentation for this module is not yet available or its path is missing.</p>';
      return;
    }

    try {
      const response = await fetch(moduleInfo.contentPath);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const fileContent = await response.text();

      contentTitle.textContent = moduleInfo.title;
      authorReviewerInfo.innerHTML = `
        <p><strong>Author:</strong> <a href="#" class="profile-link" data-profile-name="${
          moduleInfo.author
        }">${moduleInfo.author || "N/A"}</a></p>
        <p><strong>Reviewer:</strong> <a href="#" class="profile-link" data-profile-name="${
          moduleInfo.reviewer
        }">${moduleInfo.reviewer || "N/A"}</a></p>
      `;

      // All content files are now HTML (MHT files have been converted)
      contentBody.innerHTML = fileContent;
      setTimeout(() => {
        addCopyToClipboardButtons();
        applyCodeHighlighting();
      }, 0);
      if (contentArea) {
        contentArea.scrollTop = 0;
      }
    } catch (error) {
      console.error(`Error loading content for ${identifier}:`, error);
      contentTitle.textContent = "Error Loading Content";
      authorReviewerInfo.innerHTML = "";
      contentBody.innerHTML = `
        <p class="error-message">Failed to load module content for "${identifier}". Please try again.</p>
        <p class="error-message">Details: ${error.message}</p>
      `;
    }
  }*/
  async function loadContent(identifier) {
    console.log("Loading content for identifier:", identifier); // DEBUG

    contentTitle.textContent = "Loading...";
    authorReviewerInfo.innerHTML = "";

    // Get the iframe element
    const contentFrame = document.getElementById("content-frame");

    if (!contentFrame) {
      console.error("ERROR: content-frame iframe not found in DOM!");
      return;
    }

    // Handle profile pages
    if (identifier.startsWith("profile_")) {
      const encodedProfileName = identifier.substring("profile_".length);
      const profileName = decodeURIComponent(encodedProfileName);
      renderProfilePageInIframe(profileName, contentFrame);
      return;
    }

    // Find module info
    let moduleInfo = null;
    if (flattenedModulesForSearch[identifier]) {
      moduleInfo = flattenedModulesForSearch[identifier];
    } else if (identifier === "Welcome") {
      moduleInfo = {
        id: "Welcome",
        title: "Welcome to SAP Documentation",
        author: "Documentation Team",
        reviewer: "Lead Architect",
        contentPath: "src/content/Welcome.html",
      };
    }

    console.log("Module info:", moduleInfo); // DEBUG

    if (!moduleInfo || !moduleInfo.contentPath) {
      contentTitle.textContent = "Content Not Found";
      authorReviewerInfo.innerHTML = "";
      const errorHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: 'Inter', sans-serif; 
            padding: 20px;
            color: #ef4444;
          }
        </style>
      </head>
      <body>
        <p class="error-message">The requested content could not be found.</p>
        <p style="font-size: 12px; color: #999;">Identifier: ${identifier}</p>
      </body>
      </html>
    `;
      contentFrame.srcdoc = errorHTML;
      return;
    }

    try {
      // Set title and author/reviewer info
      contentTitle.textContent = moduleInfo.title;
      authorReviewerInfo.innerHTML = `
      <p><strong>Author:</strong> <a href="#" class="profile-link" data-profile-name="${moduleInfo.author}">${moduleInfo.author || 'N/A'}</a></p>
      <p><strong>Reviewer:</strong> <a href="#" class="profile-link" data-profile-name="${moduleInfo.reviewer}">${moduleInfo.reviewer || 'N/A'}</a></p>
    `;

      console.log("Attempting to load:", moduleInfo.contentPath); // DEBUG

      // Set up iframe load handlers BEFORE setting src
      let loadTimeout;

      contentFrame.onload = () => {
        console.log("Iframe loaded successfully!"); // DEBUG
        clearTimeout(loadTimeout);

        try {
          const iframeDoc = contentFrame.contentDocument || contentFrame.contentWindow.document;

          if (iframeDoc) {
            console.log("Iframe document accessible, applying enhancements..."); // DEBUG

            // Apply syntax highlighting to code blocks inside iframe
            applyCodeHighlightingInIframe(iframeDoc);

            // Add copy buttons to code blocks inside iframe
            addCopyButtonsInIframe(iframeDoc);
          } else {
            console.warn("Iframe document not accessible"); // DEBUG
          }

        } catch (e) {
          console.warn('Cannot access iframe content:', e);
        }
      };

      contentFrame.onerror = (error) => {
        console.error("Iframe error:", error); // DEBUG
        clearTimeout(loadTimeout);

        const errorHTML = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { 
              font-family: 'Inter', sans-serif; 
              padding: 20px;
              color: #ef4444;
            }
          </style>
        </head>
        <body>
          <p class="error-message">Failed to load content.</p>
          <p style="font-size: 12px; color: #999;">Path: ${moduleInfo.contentPath}</p>
          <p style="font-size: 12px; color: #999;">Check browser console for details.</p>
        </body>
        </html>
      `;
        contentFrame.srcdoc = errorHTML;
      };

      // Set timeout for loading
      loadTimeout = setTimeout(() => {
        console.warn("Iframe load timeout - checking if file exists..."); // DEBUG

        // Try to fetch the file to see if it exists
        fetch(moduleInfo.contentPath)
          .then(response => {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            console.log("File exists but iframe didn't load. Trying alternative method..."); // DEBUG
            return response.text();
          })
          .then(html => {
            // If fetch works, inject HTML directly via srcdoc
            contentFrame.srcdoc = html;
          })
          .catch(fetchError => {
            console.error("File not found:", fetchError); // DEBUG
            const errorHTML = `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { 
                  font-family: 'Inter', sans-serif; 
                  padding: 20px;
                  color: #ef4444;
                }
              </style>
            </head>
            <body>
              <p class="error-message">Content file not found!</p>
              <p style="font-size: 14px; margin-top: 20px;"><strong>Expected path:</strong></p>
              <code style="background: #f3f4f6; padding: 8px; display: block; margin: 10px 0;">${moduleInfo.contentPath}</code>
              <p style="font-size: 14px; margin-top: 20px;"><strong>Error:</strong></p>
              <code style="background: #fee; padding: 8px; display: block;">${fetchError.message}</code>
              <p style="font-size: 12px; margin-top: 20px; color: #999;">
                Make sure the file exists in your project folder at the path shown above.
              </p>
            </body>
            </html>
          `;
            contentFrame.srcdoc = errorHTML;
          });
      }, 10000); // 3 second timeout

      // Load content HTML file directly in iframe
      contentFrame.src = moduleInfo.contentPath;

      // Scroll content area to top
      if (contentArea) {
        contentArea.scrollTop = 0;
      }

    } catch (error) {
      console.error(`Error loading content for ${identifier}:`, error);
      contentTitle.textContent = "Error Loading Content";
      authorReviewerInfo.innerHTML = "";
      const errorHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: 'Inter', sans-serif; 
            padding: 20px;
            color: #ef4444;
          }
        </style>
      </head>
      <body>
        <p class="error-message">Failed to load content: ${error.message}</p>
      </body>
      </html>
    `;
      contentFrame.srcdoc = errorHTML;
    }
  }

  // --- Function: Apply Code Highlighting Inside Iframe ---
  function applyCodeHighlightingInIframe(iframeDoc) {
    const codeBlocks = iframeDoc.querySelectorAll("code[class*='language-']");

    codeBlocks.forEach((codeBlock) => {
      const languageClass = Array.from(codeBlock.classList).find((cls) =>
        cls.startsWith("language-")
      );
      if (!languageClass) return;

      const language = languageClass.replace("language-", "").toLowerCase();
      const langData = languageKeywords[language];
      if (!langData) {
        console.warn(`Language "${language}" not found in keywords.json`);
        return;
      }

      const allKeywordsForLang = new Set();
      Object.keys(langData).forEach((category) => {
        if (Array.isArray(langData[category])) {
          langData[category].forEach((keyword) => {
            allKeywordsForLang.add(keyword);
          });
        }
      });

      const text = codeBlock.textContent;
      codeBlock.innerHTML = highlightText(text, language, langData, allKeywordsForLang);
    });
  }

  // --- Function: Add Copy Buttons Inside Iframe ---
  function addCopyButtonsInIframe(iframeDoc) {
    const preBlocks = iframeDoc.querySelectorAll("pre");

    preBlocks.forEach((pre) => {
      // Check if button already exists
      if (pre.querySelector(".copy-button")) return;

      const button = iframeDoc.createElement("button");
      button.className = "copy-button";
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy code to clipboard");

      button.addEventListener("click", () => {
        // Get the code element inside pre
        const codeElement = pre.querySelector("code");
        let textToCopy = "";

        if (codeElement) {
          // Get text from code element only (excludes button)
          textToCopy = codeElement.textContent || codeElement.innerText || "";
        } else {
          // Fallback: get all text and remove button text
          textToCopy = pre.textContent || pre.innerText || "";
          // Remove button text from copied content
          textToCopy = textToCopy.replace(/^Copy\s*/, "").replace(/Copy$/, "").trim();
        }

        if (textToCopy.trim() === "") {
          button.textContent = "Empty!";
          button.classList.add("error");
          setTimeout(() => {
            button.textContent = "Copy";
            button.classList.remove("error");
          }, 2000);
          return;
        }

        // Try Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(textToCopy)
            .then(() => {
              button.textContent = "Copied!";
              button.classList.add("copied");
              setTimeout(() => {
                button.textContent = "Copy";
                button.classList.remove("copied");
              }, 2000);
            })
            .catch((err) => {
              console.error("Clipboard API error:", err);
              const success = fallbackCopyTextToClipboard(textToCopy);
              updateButtonStatus(button, success);
            });
        } else {
          const success = fallbackCopyTextToClipboard(textToCopy);
          updateButtonStatus(button, success);
        }
      });

      pre.appendChild(button);
    });
  }


  // --- Helper: Update Copy Button Status ---
  function updateButtonStatus(button, success) {
    if (success) {
      button.textContent = "Copied!";
      button.classList.add("copied");
      setTimeout(() => {
        button.textContent = "Copy";
        button.classList.remove("copied");
      }, 2000);
    } else {
      button.textContent = "Error";
      button.classList.add("error");
      setTimeout(() => {
        button.textContent = "Copy";
        button.classList.remove("error");
      }, 2000);
    }
  }

  // --- Function: Render Profile Page in Iframe ---
  function renderProfilePageInIframe(profileName, contentFrame) {
    const profileData = allAuthorsReviewers[profileName];

    if (!profileData) {
      contentTitle.textContent = "Profile Not Found";
      authorReviewerInfo.innerHTML = "";
      const errorHTML = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: 'Inter', sans-serif; 
            padding: 20px;
            color: #ef4444;
          }
        </style>
      </head>
      <body>
        <p class="error-message">The requested profile could not be found.</p>
      </body>
      </html>
    `;
      contentFrame.srcdoc = errorHTML;
      return;
    }

    contentTitle.textContent = `${profileData.name}'s Profile`;
    authorReviewerInfo.innerHTML = `
    ${profileData.contact && profileData.contact.email ? `<p><strong>Role:</strong> ${profileData.role || 'N/A'}</p>` : ""}
    ${profileData.contact && profileData.contact.email ? `<p><strong>Email:</strong> ${profileData.contact.email}</p>` : ""}
    ${profileData.contact && profileData.contact.linkedin ? `<p><strong>LinkedIn:</strong> <a href="${profileData.contact.linkedin}" target="_blank">Connect on LinkedIn</a></p>` : ""}
    ${profileData.contact && profileData.contact.website ? `<p><strong>Website:</strong> ${profileData.contact.website}</p>` : ""}
  `;

    let profileImageHtml = profileData.profilePicture
      ? `<img src="${profileData.profilePicture}" alt="${profileData.name}" style="max-width: 200px; border-radius: 8px;">`
      : "";

    let bioHtml = profileData.bio ? `<p>${profileData.bio}</p>` : "";

    let authoredHtml = "";
    if (profileData.authoredContent && profileData.authoredContent.length > 0) {
      authoredHtml = `
      <h3>Authored Content:</h3>
      <ul>
        ${profileData.authoredContent.map(item => `<li><a href="#${item.id}" class="profile-content-link" data-module="${item.id}">${item.title}</a></li>`).join("")}
      </ul>
    `;
    } else {
      authoredHtml = "<p>No content authored.</p>";
    }

    let reviewedHtml = "";
    if (profileData.reviewedContent && profileData.reviewedContent.length > 0) {
      reviewedHtml = `
      <h3>Reviewed Content:</h3>
      <ul>
        ${profileData.reviewedContent.map(item => `<li><a href="#${item.id}" class="profile-content-link" data-module="${item.id}">${item.title}</a></li>`).join("")}
      </ul>
    `;
    } else {
      reviewedHtml = "<p>No content reviewed.</p>";
    }

    const profileHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { 
          font-family: 'Inter', sans-serif; 
          padding: 20px;
          line-height: 1.6;
          color: #374151;
        }
        h3 { color: #1f2937; margin-top: 24px; }
        ul { padding-left: 20px; }
        a { color: #3b82f6; text-decoration: none; }
        a:hover { text-decoration: underline; }
        img { margin-bottom: 16px; }
      </style>
    </head>
    <body>
      ${profileImageHtml}
      ${bioHtml}
      ${authoredHtml}
      ${reviewedHtml}
    </body>
    </html>
  `;

    contentFrame.srcdoc = profileHTML;

    if (contentArea) {
      contentArea.scrollTop = 0;
    }
  }


  // --- Helper: Activates navigation link, loads content, and updates URL ---
  function activateNavLinkAndLoadContent(identifier, pushState = true) {
    const currentActiveLinks = document.querySelectorAll(
      ".module-submenu a.active, .flat-module-link.active, .module-group-link.active, .search-result-link.active"
    );
    currentActiveLinks.forEach((otherLink) => {
      otherLink.classList.remove("active");
    });

    loadContent(identifier);

    if (!identifier.startsWith("profile_")) {
      const newActiveLink = document.querySelector(
        `[data-module="${identifier}"]`
      );
      if (newActiveLink) {
        newActiveLink.classList.add("active");

        const parentSubmenu = newActiveLink.closest(".module-submenu");
        if (parentSubmenu) {
          const parentHeader = parentSubmenu.previousElementSibling;
          if (parentHeader && !parentHeader.classList.contains("expanded")) {
            parentHeader.classList.add("expanded");
            parentSubmenu.style.display = "block";
          }
        }
      }
    }

    if (pushState) {
      history.pushState(null, "", `#${identifier}`);
    }
  }

  // --- Helper function to handle module link clicks (deduplicated logic) ---
  function handleModuleLinkClick(clickedLink) {
    const moduleId = clickedLink.dataset.module;
    if (moduleId) {
      activateNavLinkAndLoadContent(moduleId);
    }
  }

  // --- Event Listener for Logo Click ---
  const siteLogo = document.querySelector(".site-logo a");
  if (siteLogo) {
    siteLogo.addEventListener("click", (event) => {
      event.preventDefault();
      activateNavLinkAndLoadContent("Welcome");
      searchInput.value = "";
      moduleFilter.value = "";
      searchResultsDiv.innerHTML = "";
      searchResultsDiv.style.display = "none";
      moduleList.style.display = "block";
    });
  }

  // --- Master Delegated Event Listener for Clicks ---
  document.addEventListener("click", function (event) {
    const target = event.target;

    const contentLoadingLink = target.closest(
      ".flat-module-link, .module-submenu a, .search-result-link, .profile-content-link"
    );
    if (contentLoadingLink) {
      event.preventDefault();
      handleModuleLinkClick(contentLoadingLink);
      return;
    }

    const profileLink = target.closest(".profile-link");
    if (profileLink) {
      event.preventDefault();
      const profileName = profileLink.dataset.profileName;
      // Only navigate if the profile exists in our loaded data
      if (
        profileName &&
        profileName !== "N/A" &&
        allAuthorsReviewers[profileName]
      ) {
        activateNavLinkAndLoadContent(`profile_${profileName}`);
      } else if (profileName && profileName !== "N/A") {
        console.warn(`Profile for "${profileName}" not found in authors.json.`);
        // Optionally, display a small message to the user that profile isn't available
      }
      return;
    }

    const header = target.closest(".module-header");
    if (header) {
      const isArrowToggleClicked = target.closest(".dropdown-toggle-area");
      const moduleGroupLink = header.querySelector(".module-group-link");

      if (isArrowToggleClicked) {
        const submenu = header.nextElementSibling;
        if (submenu && submenu.classList.contains("module-submenu")) {
          header.classList.toggle("expanded");
          submenu.style.display = header.classList.contains("expanded")
            ? "block"
            : "none";
        }
      } else if (moduleGroupLink) {
        event.preventDefault();
        handleModuleLinkClick(moduleGroupLink);
        searchInput.value = "";
        moduleFilter.value = "";
        searchResultsDiv.innerHTML = "";
        searchResultsDiv.style.display = "none";
        moduleList.style.display = "block";
      }
      return;
    }
  });

  // --- Search and Filter Functionality ---
  function performSearch() {
    const query = searchInput.value.toLowerCase().trim();
    const selectedModuleId = moduleFilter.value;

    const isSearchActive = query.length > 0 || selectedModuleId.length > 0;
    moduleList.style.display = isSearchActive ? "none" : "block";
    searchResultsDiv.style.display = isSearchActive ? "block" : "none";
    searchResultsDiv.innerHTML = "";

    if (!isSearchActive) {
      return;
    }

    const matchingResults = [];
    const matchedProfileNames = new Set(); // To avoid duplicate profile results by name

    // Search through modules
    Object.values(flattenedModulesForSearch).forEach((module) => {
      const title = module.title.toLowerCase();
      const keywords = module.keywords || [];
      const author = module.author ? module.author.toLowerCase() : "";
      const reviewer = module.reviewer ? module.reviewer.toLowerCase() : "";

      if (!module.contentPath && keywords.length === 0) {
        return;
      }

      let score = 0;

      if (query.length > 0) {
        if (title === query) {
          score += 100;
        } else if (title.startsWith(query)) {
          score += 70;
        } else if (title.includes(query)) {
          score += 50;
        }

        for (const keyword of keywords) {
          if (keyword === query) {
            score += 40;
          } else if (keyword.includes(query)) {
            score += 20;
          }
        }

        // Add points for author/reviewer match.
        // If a profile exists in authors.json for this person, add a profile result.
        if (
          author.includes(query) &&
          module.author &&
          module.author !== "N/A"
        ) {
          score += 60;
          if (
            allAuthorsReviewers[module.author] &&
            !matchedProfileNames.has(module.author)
          ) {
            matchingResults.push({
              id: `profile_${module.author}`,
              title: `Profile: ${module.author}`,
              type: "profile",
              score: 200, // High score to prioritize profiles
            });
            matchedProfileNames.add(module.author);
          }
        }
        if (
          reviewer.includes(query) &&
          module.reviewer &&
          module.reviewer !== "N/A"
        ) {
          score += 60;
          if (
            allAuthorsReviewers[module.reviewer] &&
            !matchedProfileNames.has(module.reviewer)
          ) {
            matchingResults.push({
              id: `profile_${module.reviewer}`,
              title: `Profile: ${module.reviewer}`,
              type: "profile",
              score: 200, // High score to prioritize profiles
            });
            matchedProfileNames.add(module.reviewer);
          }
        }
      } else {
        score = 1;
      }

      const matchesFilter =
        selectedModuleId.length === 0 ||
        module.parentModuleId === selectedModuleId ||
        module.id === selectedModuleId;

      if (score > 0 && matchesFilter) {
        // Only add a module result if it hasn't been added as a profile for this exact module ID
        // (This check is less critical now that profile names are distinct types of results)
        matchingResults.push({ ...module, score, type: "module" });
      }
    });

    // Final deduplication for search results to ensure unique module IDs and profile names
    const finalResults = [];
    const seenModuleIds = new Set(); // For module results
    const seenProfileResultIds = new Set(); // For profile results (using their 'id' like 'profile_Name')

    // Sort by score first to ensure higher-scoring duplicates are kept
    matchingResults.sort((a, b) => b.score - a.score);

    matchingResults.forEach((result) => {
      if (result.type === "profile") {
        if (!seenProfileResultIds.has(result.id)) {
          finalResults.push(result);
          seenProfileResultIds.add(result.id);
        }
      } else if (result.type === "module") {
        if (!seenModuleIds.has(result.id)) {
          finalResults.push(result);
          seenModuleIds.add(result.id);
        }
      }
    });

    // Final sort for display order (should largely be sorted already)
    finalResults.sort((a, b) => b.score - a.score);

    if (finalResults.length > 0) {
      const ul = document.createElement("ul");
      ul.className = "search-results-list";
      finalResults.forEach((result) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = `#${result.id}`;
        a.textContent = result.title;
        a.dataset.module = result.id;
        a.className = "search-result-link";
        li.appendChild(a);
        ul.appendChild(li);
      });
      searchResultsDiv.appendChild(ul);
    } else {
      searchResultsDiv.innerHTML = `
        <p class="no-results-message">No matching documents or profiles found for "${query}" ${selectedModuleId ? `in selected module.` : "."
        }</p>
      `;
    }
  }

  // --- Event Listeners for Search and Filter ---
  searchInput.addEventListener("input", performSearch);
  moduleFilter.addEventListener("change", performSearch);







  // --- Handle Initial Page Load and Browser History (Back/Forward Buttons) ---
  function handleInitialLoadAndPopstate() {
    const hash = window.location.hash.substring(1);
    const identifierToLoad = hash || "Welcome";

    activateNavLinkAndLoadContent(identifierToLoad, false);
  }

  // Listen for browser back/forward buttons
  window.addEventListener("popstate", handleInitialLoadAndPopstate);

  // --- Initial Load ---
  // Load keywords, authors.json, and modules.json
  Promise.all([loadKeywords(), loadAuthors(), loadModules()])
    .then(() => {
      populateAuthorReviewerContentLists(); // This now runs AFTER both are loaded
      handleInitialLoadAndPopstate();
    })
    .catch((error) => {
      console.error("Failed to load all initial data:", error);
      // Display a more general error if critical data cannot be loaded
    });
});
// ===== RESIZABLE SPLITTER FUNCTIONALITY =====
const splitter = document.getElementById('splitter');
const mainNav = document.getElementById('main-nav');
const contentArea = document.getElementById('content-area-wrapper');
let isResizing = false;

splitter.addEventListener('mousedown', (e) => {
  isResizing = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;

  const newWidth = e.clientX;

  // Constrain width between 200px and 600px
  if (newWidth >= 200 && newWidth <= 600) {
    mainNav.style.width = `${newWidth}px`;
  }
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// ===== TOGGLE NAVIGATION VISIBILITY =====
const toggleNavBtn = document.getElementById('toggle-nav-btn');
let navVisible = true; // Track navigation visibility state

// Create "Show Navigation" button (appears when nav is hidden)
const showNavBtn = document.createElement('button');
showNavBtn.id = 'show-nav-btn';
showNavBtn.className = 'icon-button';
showNavBtn.title = 'Show Navigation';
showNavBtn.innerHTML = `
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M9 6l6 6-6 6"/>
  </svg>
`;
showNavBtn.style.display = 'none'; // Hidden by default
document.body.appendChild(showNavBtn);

toggleNavBtn.addEventListener('click', () => {
  navVisible = !navVisible;

  if (navVisible) {
    // ===== SHOW NAVIGATION =====
    mainNav.classList.remove('hidden');
    mainNav.style.display = 'flex';
    splitter.style.display = 'block';
    showNavBtn.classList.remove('visible');
    showNavBtn.style.display = 'none';

    toggleNavBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    `;
    toggleNavBtn.title = 'Hide Navigation';

  } else {
    // ===== HIDE NAVIGATION =====
    mainNav.classList.add('hidden');
    splitter.style.display = 'none';
    showNavBtn.classList.add('visible');
    showNavBtn.style.display = 'flex';

    toggleNavBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 6l6 6-6 6"/>
      </svg>
    `;
    toggleNavBtn.title = 'Show Navigation';
  }
});

showNavBtn.addEventListener('click', () => {
  toggleNavBtn.click(); // Trigger the same toggle
});

// ===== EXPAND/FULLSCREEN CONTENT FUNCTIONALITY =====
const expandBtn = document.getElementById('expand-content-btn');
let isExpanded = false;

// Create a floating exit button for fullscreen mode
const floatingExitBtn = document.createElement('button');
floatingExitBtn.id = 'floating-exit-btn';
floatingExitBtn.className = 'icon-button floating-exit-button';
floatingExitBtn.title = 'Exit Fullscreen';
floatingExitBtn.innerHTML = `
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
  </svg>
`;
floatingExitBtn.style.display = 'none'; // Hidden by default
document.body.appendChild(floatingExitBtn);

expandBtn.addEventListener('click', () => {
  isExpanded = !isExpanded;

  if (isExpanded) {
    // ===== FULLSCREEN MODE =====
    contentArea.classList.add('expanded');

    // Hide navigation and splitter
    mainNav.style.display = 'none';
    splitter.style.display = 'none';

    // Hide show navigation button if it's visible
    if (showNavBtn.classList.contains('visible')) {
      showNavBtn.style.display = 'none';
    }

    // Show floating exit button
    floatingExitBtn.style.display = 'flex';

  } else {
    // ===== NORMAL MODE =====
    contentArea.classList.remove('expanded');

    // Restore navigation visibility based on previous state
    if (navVisible) {
      // Navigation was visible before fullscreen
      mainNav.style.display = 'flex';
      mainNav.classList.remove('hidden');
      splitter.style.display = 'block';
      showNavBtn.classList.remove('visible');
      showNavBtn.style.display = 'none';
    } else {
      // Navigation was hidden before fullscreen
      mainNav.style.display = 'flex'; // Need to display it first
      mainNav.classList.add('hidden'); // Then hide it with animation
      splitter.style.display = 'none';
      showNavBtn.classList.add('visible');
      showNavBtn.style.display = 'flex';
    }

    // Hide floating exit button
    floatingExitBtn.style.display = 'none';
  }
});

// Floating exit button click handler
floatingExitBtn.addEventListener('click', () => {
  if (isExpanded) {
    expandBtn.click(); // Trigger normal expand button to exit fullscreen
  }
});

// ESC key to exit fullscreen
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isExpanded) {
    expandBtn.click();
  }
});
