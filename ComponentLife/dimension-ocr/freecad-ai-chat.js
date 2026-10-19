/**
 * FreeCAD AI Chat Assistant (Conversational 2D-to-3D Reasoning with FreeCAD MCP)
 * 
 * Provides an AI chat interface allowing users to upload cross-section/cut-view images,
 * inspect geometric reasoning, and execute CAD modeling via FreeCAD MCP and local WASM kernel.
 */

import { analyzeCrop, toModel } from './cad-geometry.js';
import { extractViewFeatures, solveMultiViewGeometry } from './hybrid-cad-solver.js';

export function mountAiChat(container, hooks) {
  const host = document.createElement('div');
  host.className = 'ai-chat-dock';
  host.innerHTML = `
    <div class="ai-chat-header">
      <div class="title">
        <span>🤖</span>
        <strong>FreeCAD AI Copilot</strong>
      </div>
      <div class="ai-mcp-status" id="chat-mcp-status" title="Trạng thái kết nối FreeCAD MCP trên máy">
        <span class="status-dot">●</span>
        <span id="chat-mcp-label">FreeCAD MCP: Chưa ghép nối</span>
      </div>
    </div>

    <div class="ai-chat-messages" id="chat-messages-list">
      <div class="ai-msg assistant">
        <div class="ai-msg-bubble">
          <strong>Xin chào!</strong> Tôi là trợ lý AI suy luận hình học và tái tạo mô hình 3D cho FreeCAD.<br><br>
          Bạn có thể <b>tải ảnh mặt cắt (cross-section)</b> hoặc hình chiếu 2D lên đây để kiểm tra năng lực suy luận hình học của model và tự động sinh lệnh FreeCAD MCP dựng khối 3D!
        </div>
      </div>
    </div>

    <div class="ai-quick-prompts">
      <button class="ai-chip" data-prompt="reconstruct">📷 Dựng 3D từ ảnh</button>
      <button class="ai-chip" data-prompt="analyze">🔍 Phân tích mặt cắt</button>
      <button class="ai-chip" data-prompt="mcp">🧊 Tạo lệnh FreeCAD MCP</button>
      <button class="ai-chip" data-prompt="crop">📐 Dùng Crop từ bản vẽ</button>
    </div>

    <div class="ai-chat-input-area">
      <div class="ai-attachment-preview" id="chat-attachment-preview" hidden>
        <img id="chat-preview-img" src="" alt="View cắt">
        <div class="ai-attachment-info" id="chat-preview-info">Ảnh mặt cắt</div>
        <button class="ai-attachment-remove" id="chat-remove-attachment" title="Xóa ảnh">×</button>
      </div>

      <div class="ai-input-row">
        <input type="file" id="chat-file-input" accept="image/png,image/jpeg,image/webp" hidden>
        <button class="ai-upload-btn" id="chat-btn-upload" title="Tải ảnh mặt cắt hoặc hình chiếu 2D">📎</button>
        <input type="text" class="ai-chat-input" id="chat-user-input" placeholder="Nhập yêu cầu hoặc tải ảnh mặt cắt...">
        <button class="ai-send-btn" id="chat-btn-send" title="Gửi yêu cầu">➤</button>
      </div>
    </div>
  `;

  container.replaceChildren(host);

  const messagesList = host.querySelector('#chat-messages-list');
  const userInput = host.querySelector('#chat-user-input');
  const btnSend = host.querySelector('#chat-btn-send');
  const btnUpload = host.querySelector('#chat-btn-upload');
  const fileInput = host.querySelector('#chat-file-input');
  const attachmentPreview = host.querySelector('#chat-attachment-preview');
  const previewImg = host.querySelector('#chat-preview-img');
  const previewInfo = host.querySelector('#chat-preview-info');
  const btnRemoveAttachment = host.querySelector('#chat-remove-attachment');
  const mcpStatusLabel = host.querySelector('#chat-mcp-label');
  const mcpStatusBadge = host.querySelector('#chat-mcp-status');

  let currentAttachment = null; // { file, url, canvas, name }
  let bridgeAddress = 'http://127.0.0.1:8766';
  let isProcessing = false;

  // Check FreeCAD MCP bridge availability
  checkMcpBridge();

  async function checkMcpBridge() {
    const connected=hooks.freecad?.isConnected()===true;
    mcpStatusBadge.classList.toggle('disconnected',!connected);
    mcpStatusLabel.textContent=connected?'FreeCAD MCP: Đã ghép nối':'FreeCAD MCP: Chưa ghép nối';
  }
  document.addEventListener('freecad-local-status',checkMcpBridge);

  // Handle Image Upload
  btnUpload.onclick = () => fileInput.click();

  fileInput.onchange = e => {
    const file = e.target.files[0];
    if (file) handleImageFile(file);
    fileInput.value = '';
  };

  // Drag and drop support
  host.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
  host.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleImageFile(file);
    }
  });

  function handleImageFile(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth || img.width;
      cv.height = img.naturalHeight || img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);

      currentAttachment = {
        file,
        url,
        canvas: cv,
        name: file.name,
        width: cv.width,
        height: cv.height
      };

      previewImg.src = url;
      previewInfo.textContent = `${file.name} (${cv.width}×${cv.height}px)`;
      attachmentPreview.hidden = false;
      userInput.placeholder = 'Nhập câu hỏi hoặc nhấn ➤ để AI dựng 3D từ ảnh này...';
      userInput.focus();
    };
    img.src = url;
  }

  btnRemoveAttachment.onclick = () => {
    if (currentAttachment?.url) URL.revokeObjectURL(currentAttachment.url);
    currentAttachment = null;
    attachmentPreview.hidden = true;
    userInput.placeholder = 'Nhập yêu cầu hoặc tải ảnh mặt cắt...';
  };

  // Quick chips handler
  host.querySelectorAll('.ai-chip').forEach(chip => {
    chip.onclick = () => {
      const action = chip.dataset.prompt;
      if (action === 'crop') {
        // Use active crop from drawing sheet
        const crops = hooks.getCrops();
        if (!crops.length) {
          appendMessage('assistant', 'Hiện tại chưa có vùng Crop nào trên bản vẽ. Bạn có thể bấm nút <b>📎</b> để tải ảnh mặt cắt từ máy tính lên.');
          return;
        }
        const cr = crops[0];
        const url = cr.canvas.toDataURL();
        currentAttachment = {
          file: null,
          url,
          canvas: cr.canvas,
          name: `Drawing_Crop_${cr.id}.png`,
          width: cr.canvas.width,
          height: cr.canvas.height
        };
        previewImg.src = url;
        previewInfo.textContent = `Crop #${cr.id} (${cr.canvas.width}×${cr.canvas.height}px)`;
        attachmentPreview.hidden = false;
        appendMessage('user', `Sử dụng ảnh Crop #${cr.id} từ bản vẽ để phân tích.`, url);
        processImageReconstruction(currentAttachment, 'Dựng khối 3D từ Crop bản vẽ này');
      } else if (action === 'reconstruct') {
        if (!currentAttachment) {
          fileInput.click();
        } else {
          sendMessage('Dựng khối 3D từ ảnh mặt cắt này');
        }
      } else if (action === 'analyze') {
        if (!currentAttachment) {
          fileInput.click();
        } else {
          sendMessage('Phân tích chi tiết các đặc trưng hình học của mặt cắt');
        }
      } else if (action === 'mcp') {
        sendMessage('Sinh chuỗi lệnh FreeCAD MCP tương ứng cho mô hình');
      }
    };
  });

  // Send message
  btnSend.onclick = () => sendMessage(userInput.value.trim());
  userInput.onkeydown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(userInput.value.trim());
    }
  };

  function appendMessage(role, textHtml, imageUrl = null) {
    const msg = document.createElement('div');
    msg.className = `ai-msg ${role}`;
    let content = '';
    if (imageUrl) {
      content += `<div class="ai-msg-image"><img src="${imageUrl}" alt="Uploaded view"></div>`;
    }
    content += `<div class="ai-msg-bubble">${textHtml}</div>`;
    msg.innerHTML = content;
    messagesList.append(msg);
    messagesList.scrollTop = messagesList.scrollHeight;
    return msg;
  }

  async function sendMessage(text) {
    if (isProcessing) return;
    if (!text && !currentAttachment) return;

    const attached = currentAttachment;
    currentAttachment = null;
    attachmentPreview.hidden = true;
    userInput.value = '';

    // Append user message
    appendMessage('user', text || 'Dựng khối 3D từ ảnh này', attached?.url);

    isProcessing = true;
    btnSend.disabled = true;

    // Process
    if (attached) {
      await processImageReconstruction(attached, text);
    } else {
      await processTextQuery(text);
    }

    isProcessing = false;
    btnSend.disabled = false;
  }

  /**
   * Main AI Geometric Reasoning on Image
   */
  async function processImageReconstruction(attachment, userPrompt) {
    const thinkingMsg = appendMessage('assistant', `
      <div style="display:flex;align-items:center;gap:8px;color:#20c997;">
        <span class="status-dot">●</span>
        <em>Đang giải mã ma trận điểm ảnh và suy luận hình học mặt cắt...</em>
      </div>
    `);

    try {
      // 1. Computer Vision Feature Extraction on Image
      const rawAnalysis = analyzeCrop(attachment.canvas);
      const cropMock = {
        id: 'upload',
        canvas: attachment.canvas,
        mm: 0.1, // standard 0.1mm per pixel default
        origin: [attachment.canvas.width / 2, attachment.canvas.height / 2],
        rawAnalysis,
        face: 'Top'
      };

      const features = extractViewFeatures(cropMock);

      // 2. Geometry Reasoning
      const isSymmetric = checkSymmetry(features);
      const isHollow = features.circles.length > 0 || features.outlines.length > 1;
      const b = features.bounds;

      // 3. Multi-view & Strategy Solving
      const solution = solveMultiViewGeometry([features], {
        defaultDepth: 20
      });

      const spec = solution.spec;

      // Generate FreeCAD MCP Tool Sequence
      let mcpCommands=[],mcpUnavailable='';
      try{mcpCommands=generateFreeCadMcpSequence(solution);}catch(e){mcpUnavailable=e.message;}

      // Build thinking log
      const reasoningItems = [
        `<b>Phân tích ma trận pixel:</b> Kích thước ảnh ${attachment.width}×${attachment.height}px, tỷ lệ khung hình ${(b.width / (b.height || 1)).toFixed(2)}.`,
        `<b>Đường bao đa giác kín (Outer contour):</b> Nhận diện được ${spec.profile.length} đỉnh biên dạng chính, diện tích bao ${(b.width * b.height).toFixed(1)} mm².`,
        features.circles.length > 0
          ? `<b>Đặc tính âm (Holes/Voids):</b> Phát hiện ${features.circles.length} đường tròn/lỗ rỗng: ${features.circles.map(c => `Ø${c.diameter.toFixed(1)}mm`).join(', ')}.`
          : `<b>Đặc tính âm:</b> Mặt cắt dạng khối đặc (solid), không có lỗ xuyên rỗng.`,
        isSymmetric
          ? `<b>Suy luận tính đối xứng:</b> Biên dạng có tính đối xứng trục. Có thể áp dụng phương pháp <code>Revolve</code> (Xoay 360°) hoặc <code>Pad</code> đối xứng.`
          : `<b>Phương pháp tạo hình:</b> Áp dụng phép đùn <code>Pad</code> theo trục Z với chiều dày Z = ${spec.depth} mm.`,
        `<b>Khớp chuẩn FreeCAD MCP:</b> Tự động ánh xạ vào bộ công cụ <code>Sketcher</code> và <code>PartDesign</code>.`
      ];

      // Replace thinking message with full AI response
      thinkingMsg.querySelector('.ai-msg-bubble').innerHTML = `
        <div style="font-size:13px;font-weight:600;color:#f0f3f6;margin-bottom:6px;">
          ✓ Đã phân tích xong ảnh mặt cắt <b>${attachment.name}</b>
        </div>
        <p style="margin:0 0 8px 0;color:#c9d1d9;">${solution.summary}</p>

        <details class="ai-reasoning-box" open>
          <summary>🧠 Chi tiết suy luận của Model Local</summary>
          <div class="ai-reasoning-content">
            <ol>
              ${reasoningItems.map(item => `<li>${item}</li>`).join('')}
            </ol>
          </div>
        </details>

        <details class="ai-reasoning-box">
          <summary>🛠️ Chuỗi lệnh FreeCAD MCP đã sinh (${mcpCommands.length} bước)</summary>
          <div class="ai-reasoning-content">
            ${mcpCommands.map(cmd => `
              <div class="ai-tool-call">
                <span class="tool-name">${cmd.tool}</span>(${JSON.stringify(cmd.args).slice(0, 100)}...)
              </div>
            `).join('')}
          </div>
        </details>

        <div class="ai-actions-row">
          <button class="ai-action-btn primary" id="btn-build-web-3d">🧊 Dựng mô hình 3D (WASM)</button>
          <button class="ai-action-btn" id="btn-call-mcp-pc">▶ Chạy trên FreeCAD Desktop</button>
          <button class="ai-action-btn" id="btn-view-sketch-2d">📐 Xem phác thảo 2D</button>
        </div>
      `;

      // Wire Action Buttons
      thinkingMsg.querySelector('#btn-build-web-3d').onclick = async () => {
        hooks.setProfile(spec.profile, spec.circle || null, spec.holes || [], spec.pockets || [], spec.depth);
        if (solution.method === 'revolve') {
          await hooks.revolveSolid();
        } else {
          await hooks.buildSolid();
        }
        hooks.switchView('model');
        appendMessage('assistant', `✓ Đã dựng thành công khối 3D trong <b>3D Solid View</b>. Bạn có thể dùng chuột xoay và quan sát trong Viewport!`);
      };

      thinkingMsg.querySelector('#btn-call-mcp-pc').onclick = async () => {
        await executeFreeCadMcpLive(mcpCommands);
      };
      thinkingMsg.querySelector('#btn-call-mcp-pc').disabled=!!mcpUnavailable;
      thinkingMsg.querySelector('#btn-call-mcp-pc').title=mcpUnavailable;
      if(mcpUnavailable){const note=document.createElement('p');note.textContent=mcpUnavailable;thinkingMsg.querySelector('.ai-actions-row').after(note);}

      thinkingMsg.querySelector('#btn-view-sketch-2d').onclick = () => {
        hooks.setProfile(spec.profile, spec.circle || null, spec.holes || [], spec.pockets || [], spec.depth);
        hooks.switchView('sketch');
        appendMessage('assistant', `Đã nạp biên dạng vào <b>2D Sketcher</b>. Bạn có thể kiểm tra và vẽ thêm các ràng buộc nếu cần.`);
      };

      // Auto-preview in 3D right away!
      hooks.setProfile(spec.profile, spec.circle || null, spec.holes || [], spec.pockets || [], spec.depth);
      if (solution.method === 'revolve') {
        hooks.revolveSolid().catch(() => {});
      } else {
        hooks.buildSolid().catch(() => {});
      }

    } catch (err) {
      console.error(err);
      thinkingMsg.querySelector('.ai-msg-bubble').innerHTML = `
        <span style="color:#ff6b6b;">Lỗi phân tích hình học ảnh:</span> ${err.message}<br><br>
        <small class="muted">Hãy thử một ảnh mặt cắt khác có nét vẽ rõ ràng hơn hoặc tăng độ tương phản.</small>
      `;
    }
  }

  async function processTextQuery(text) {
    const t = text.toLowerCase();
    if (t.includes('mcp') || t.includes('freecad')) {
      await checkMcpBridge();
      appendMessage('assistant', `
        <b>Trạng thái kết nối FreeCAD MCP:</b><br>
        - Địa chỉ cầu nối: <code>${bridgeAddress}</code><br>
        - Trạng thái: ${mcpStatusLabel.textContent}<br><br>
        Để đồng bộ với FreeCAD thật trên máy:<br>
        1. Mở FreeCAD trên máy của bạn.<br>
        2. Chạy Macro <code>FreeCAD-Web.FCMacro</code>.<br>
        3. Khởi chạy <code>node local-bridge/server.mjs</code> trên cổng 8766.
      `);
    } else {
      appendMessage('assistant', `
        Tôi đã nhận yêu cầu: "<i>${text}</i>".<br>
        Để tôi suy luận và dựng 3D chính xác, bạn hãy <b>bấm nút 📎 để tải ảnh mặt cắt hoặc hình chiếu</b> của chi tiết lên nhé!
      `);
    }
  }

  function checkSymmetry(feat) {
    const b = feat.bounds;
    return Math.abs(b.width - b.height) < 4 || feat.circles.length > 0;
  }

  function generateFreeCadMcpSequence(solution) {
    const cmds = [];
    const s = solution.spec;

    cmds.push({
      tool: 'freecad_new_document',
      args: { name: 'AI_Reconstructed_'+Date.now() }
    });

    cmds.push({
      tool: 'freecad_create_sketch',
      args: { name: 'Sketch_BaseProfile', plane: 'XY' }
    });

    // Add lines for profile
    if(s.circle){cmds.push({tool:'freecad_add_sketch_circle',args:{sketchName:'Sketch_BaseProfile',centerX:s.circle.center[0],centerY:s.circle.center[1],radius:s.circle.radius}});}
    else for (let i = 0; i < s.profile.length; i++) {
      const p1 = s.profile[i];
      const p2 = s.profile[(i + 1) % s.profile.length];
      cmds.push({
        tool: 'freecad_add_sketch_line',
        args: {
          sketchName: 'Sketch_BaseProfile',
          x1: p1[0], y1: p1[1],
          x2: p2[0], y2: p2[1]
        }
      });
    }

    if (solution.method === 'revolve') {
      cmds.push({
        tool: 'freecad_revolve',
        args: {
          sketchName: 'Sketch_BaseProfile',
          angle: 360,
          axisX: 0, axisY: 1, axisZ: 0
        }
      });
    } else {
      cmds.push({
        tool: 'freecad_pad',
        args: {
          sketchName: 'Sketch_BaseProfile',
          length: s.depth
        }
      });
    }

    for (const [i,h] of (s.holes || []).entries()) {
      if(h.axis&&h.axis!=='Z')throw Error('AI transfer hiện chỉ hỗ trợ lỗ trục Z; dùng form Hole/Pocket để dựng lỗ trục khác.');
      const name='HoleSketch_'+i;
      cmds.push({tool:'freecad_create_sketch',args:{name,plane:'XY'}});
      cmds.push({tool:'freecad_add_sketch_circle',args:{sketchName:name,centerX:h.x,centerY:h.y,radius:h.radius}});
      cmds.push({tool:'freecad_move_object',args:{objectName:name,x:0,y:0,z:s.depth}});
      cmds.push({tool:'freecad_pocket',args:{sketchName:name,depth:s.depth,name:'ThroughHole_'+i}});
    }
    if(s.pockets?.length||s.fillet||s.chamfer)throw Error('Có Pocket/bo/vát cần xác nhận vị trí và cạnh bằng form FreeCAD trước khi chuyển AI tự động.');

    return cmds;
  }

  async function executeFreeCadMcpLive(commands) {
    const notify = appendMessage('assistant', `Đang gửi ${commands.length} lệnh tới FreeCAD MCP trên máy…`);
    try {
      const result=await hooks.freecad.runCommands(commands);

      notify.querySelector('.ai-msg-bubble').innerHTML = `
        ✓ Đã kết nối FreeCAD Desktop!<br>
        Đã thực hiện ${result.count} lệnh trong tài liệu ${result.document}. Mô hình được đồng bộ từ FreeCAD thật.
      `;
    } catch (e) {
      const error=document.createElement('p');error.textContent='FreeCAD MCP: '+e.message;
      const note=document.createElement('small');note.textContent='Nếu một số lệnh đã chạy, dùng Đồng bộ để kiểm tra FreeCAD trước khi chạy lại.';
      notify.querySelector('.ai-msg-bubble').replaceChildren(error,note);
    }
  }

  return {
    openWithAttachment: handleImageFile,
    show: () => { host.hidden = false; },
    hide: () => { host.hidden = true; }
  };
}
