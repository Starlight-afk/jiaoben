// ==UserScript==
// @name         💯【满分助手·海旗/拓知版】银川科技学院适配
// @namespace    askAuto.haiqikeji
// @version      3.4.8
// @author       shushoujiu / 本地适配
// @description  适配拓知/海旗在线学习平台：验证码由本人填写，助手只读旁观（不 hook 弹窗、不关闭、不吞暂停、不代填、不伪造学时请求），只负责自动播放与切换视频；严格一次只切目录里紧挨着的 1 个小章节，所有切换随机等 10~20 秒；v3.4.8 加固防乱跳（绝不点击大章节标题、单标签页切换锁、导航落点校验、目录稳定期、导航锁）并提供跨页保留的最详细运行日志。
// @match        *://ycust.haiqikeji.com/*
// @match        *://*.haiqikeji.com/*
// @match        *://ycust.tuozhikj.com/*
// @match        *://*.tuozhikj.com/*
// @require      https://registry.npmmirror.com/vue/3.3.4/files/dist/vue.global.prod.js
// @require      https://registry.npmmirror.com/vue-demi/0.14.0/files/lib/index.iife.js
// @require      https://registry.npmmirror.com/pinia/2.1.6/files/dist/pinia.iife.prod.js
// @connect      api.tikuhai.com
// @connect      tk.enncy.cn
// @connect      api.muketool.com
// @connect      cx.icodef.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==

(async function(Vue, Pinia) {
	"use strict";
	var SCRIPT_VERSION = "3.4.8";
	var vue = Vue;
	var pinia = Pinia;
	if (!vue || !pinia) {
		console.error("[满分助手] Vue / Pinia 未能加载，请检查脚本管理器 @require 是否成功（本脚本已改用国内镜像）。");
		return;
	}
	var pageWindow = (() => {
		try {
			return typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;
		} catch (e) {
			return window;
		}
	})();

	/* ============================================================
	 *  0. 脚本管理器 API 兜底层
	 *     原生 GM_* 在 Tampermonkey / Violentmonkey 下存在，
	 *     但在“直接 <script> 注入”等场景不存在，这里统一兜底，
	 *     避免脚本一开头就 ReferenceError 直接白屏。
	 * ============================================================ */
	var storage = {
		get(key, fallback) {
			try {
				if (typeof GM_getValue !== "undefined") {
					var value = GM_getValue(key);
					return value === void 0 ? fallback : value;
				}
			} catch (e) {}
			try {
				var raw = pageWindow.localStorage.getItem("manfen:" + key);
				return raw == null ? fallback : JSON.parse(raw);
			} catch (e) {
				return fallback;
			}
		},
		set(key, value) {
			try {
				if (typeof GM_setValue !== "undefined") {
					GM_setValue(key, value);
					return;
				}
			} catch (e) {}
			try {
				pageWindow.localStorage.setItem("manfen:" + key, JSON.stringify(value));
			} catch (e) {}
		}
	};
	var _GM_getValue = storage.get;
	var _GM_setValue = storage.set;
	var _GM_info = (() => {
		try {
			return typeof GM_info !== "undefined" ? GM_info : { script: { version: SCRIPT_VERSION } };
		} catch (e) {
			return { script: { version: SCRIPT_VERSION } };
		}
	})();
	var _GM_xmlhttpRequest = (() => {
		if (typeof GM_xmlhttpRequest !== "undefined") return GM_xmlhttpRequest;
		// 没有 GM_xmlhttpRequest 时退化为 fetch：受同源策略限制，题库基本拿不到答案，仅避免脚本崩溃
		return function(options) {
			var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
			var timer = setTimeout(() => {
				controller && controller.abort();
			}, options.timeout || 1e4);
			fetch(options.url, {
				method: options.method || "GET",
				headers: options.headers || {},
				body: options.method && options.method.toUpperCase() !== "GET" ? options.data : void 0,
				signal: controller ? controller.signal : void 0
			}).then((res) => res.text().then((text) => {
				options.onload && options.onload({
					status: res.status,
					responseText: text,
					finalUrl: res.url
				});
			})).catch((err) => {
				options.onerror && options.onerror(err);
			}).finally(() => {
				clearTimeout(timer);
			});
		};
	})();

	/* ============================================================
	 *  1. 配置
	 * ============================================================ */
	var defaultConfig$1 = {
		debugger: false,
		interval: 3,
		answerInterval: 3,
		thtoken: "",
		yztoken: "",
		ennyctoken: "",
		autoAnswer: true,
		enabled: true,
		autoVideo: true,
		autoJump: true,
		// 所有「切到下一小节」的等待统一在 [下限, 上限] 之间随机取一个秒数，每节只随机一次。
		// v3.4.1 起默认 10~20 秒，视频播完 / 无视频 / 播放失败三种情况完全一致。
		// 用新的 *Sec 字段名，避免把旧版本保存的「分钟」配置误当成秒导致狂切。
		switchDelayMinSec: 10,
		switchDelayMaxSec: 20,
		// 播放失败或无视频时直接跳过本节；同一个视频只点击一次播放，绝不重复点击。
		skipOnFail: true,
		// v3.4.3：章末（如「第X章课后作业」）默认自动切到下一大章节的第一个小章节，
		// 仍然「一次只切一个紧邻小节」，绝不点击大章节标题、也不跳过大章节。
		// 刻意用新字段名：v3.4.2 可能已被面板保存成 crossGroup:false，
		// 沿用同名改默认值会被旧配置覆盖，导致升级后依旧卡在章末不动。
		autoNextChapter: true,
		// v3.4.8：验证码由本人填写，助手只读旁观。旧面板可能保存过
		// ignoreCaptcha / captchaAssist / captchaIgnoreOnly，这些字段一律不再读取，
		// 避免升级后又把弹窗关掉、吞掉平台暂停，导致学时归零。
		// v3.4.7：最详细运行日志。控制台全量输出 + sessionStorage 跨页保留，
		// 控制台 __mfLogText() 可导出；面板按 tag 节流，避免刷掉关键日志。
		verboseLog: true,
		// v3.4.8：同一浏览器只允许一个课程标签页发起自动切换。
		// 多开视频页时两个页面各自按目录切节，看起来就是「乱跳」，平台也会暂停学时。
		singleTabLock: true,
		// 自动关闭普通弹窗：默认开，但只点「确定/知道了/关闭」这类纯关闭词，
		// 绝不点「继续/继续学习」等会触发站点按自己进度跳转的按钮。
		autoCloseDialogs: true,
		autoSubmit: false,
		minAccuracy: .8,
		autoExam: true,
		playbackRate: 1,
		muted: true,
		forceRate: true,
		antiRewind: true,
		notice: "本脚本仅供学习交流使用，严禁用于商业用途，否则后果自负！"
	};
	var getConfig = () => {
		var saved = _GM_getValue("config");
		var merged = Object.assign({}, defaultConfig$1);
		if (saved && typeof saved === "object") Object.keys(saved).forEach((key) => {
			if (saved[key] !== void 0 && saved[key] !== null && saved[key] !== "") merged[key] = saved[key];
		});
		return merged;
	};
	var userConfig = [
		{
			name: "base",
			label: "基础配置",
			config: [
				{
					name: "interval",
					label: "通用间隔(秒)",
					type: "number",
					value: defaultConfig$1.interval,
					desc: "主循环间隔，用于脚本运行节奏"
				},
				{
					name: "answerInterval",
					label: "答题间隔(秒)",
					type: "number",
					value: defaultConfig$1.answerInterval,
					desc: "每道题之间的间隔，避免请求过快"
				},
				{
					name: "thtoken",
					label: "题库海秘钥",
					type: "input",
					value: defaultConfig$1.thtoken,
					desc: "非必填，购买后可获得，填写完请保存再刷新页面"
				},
				{
					name: "yztoken",
					label: "一之题库秘钥",
					type: "input",
					value: defaultConfig$1.yztoken,
					desc: "非必填，购买后可获得，填写完请保存再刷新页面"
				},
				{
					name: "ennyctoken",
					label: "言溪题库秘钥",
					type: "input",
					value: defaultConfig$1.ennyctoken,
					desc: "非必填，言溪题库 token，填写完请保存再刷新页面"
				}
			]
		},
		{
			name: "video",
			label: "视频配置",
			config: [
				{
					name: "autoVideo",
					label: "自动播放",
					type: "switch",
					value: defaultConfig$1.autoVideo,
					desc: "独立控制当前视频是否自动播放，不影响手动开启或关闭助手"
				},
				{
					name: "skipOnFail",
					label: "失败自动跳下一节",
					type: "switch",
					value: defaultConfig$1.skipOnFail,
					desc: "本节没有视频或点击播放失败时，直接切到下一小节；同一个视频只尝试点击一次播放，不会在原视频上反复重试或停止脚本"
				},
				{
					name: "playbackRate",
					label: "播放倍速",
					type: "number",
					value: defaultConfig$1.playbackRate,
					desc: "1 为原速；平台会把倍速压回上限，超过 1.5 需开启强制倍速"
				},
				{
					name: "muted",
					label: "自动静音",
					type: "switch",
					value: defaultConfig$1.muted,
					desc: "开启后，视频自动静音播放"
				},
				{
					name: "forceRate",
					label: "强制倍速",
					type: "switch",
					value: defaultConfig$1.forceRate,
					desc: "覆盖平台对 playbackRate 的写回限制"
				},
				{
					name: "antiRewind",
					label: "防回拽",
					type: "switch",
					value: defaultConfig$1.antiRewind,
					desc: "拦截平台把 currentTime 往回写的看门狗（仅倍速>1 时启用）"
				},
				{
					name: "autoJump",
					label: "自动切换",
					type: "switch",
					value: defaultConfig$1.autoJump,
					desc: "只按目录里的小节顺序一次切一个紧邻小章节，绝不点击或跳到大章节标题"
				},
				{
					name: "autoNextChapter",
					label: "章末进入下一章",
					type: "switch",
					value: defaultConfig$1.autoNextChapter,
					desc: "默认开启：本章最后一小节（如「第X章课后作业」）无视频或播完后，切到下一大章节的第一个小章节；仍然一次只切一个紧邻小节，绝不点击大章节标题。关闭则本章结束后停住"
				},
				{
					name: "singleTabLock",
					label: "只让一个标签页自动切换",
					type: "switch",
					value: defaultConfig$1.singleTabLock,
					desc: "默认开启：同时打开多个课程视频页时，只有最近活跃（且在前台）的那一个页面能发起自动切换，避免两个页面各自按目录跳节造成「乱跳」，也避免平台因多开而暂停学时。存储不可用或异常时自动放行，不会让脚本卡住"
				},
				{
					name: "verboseLog",
					label: "最详细运行日志",
					type: "switch",
					value: defaultConfig$1.verboseLog,
					desc: "默认开启：控制台输出每一轮循环、目录识别、当前节定位、每个切换守卫的判断、切换前后 URL、验证码状态等完整轨迹；日志跨整页刷新保留在 sessionStorage（最近 800 条），控制台执行 __mfLogText() 导出全文、__mfLogs() 看结构化数组、__mfLogClear() 清空。排查「乱跳章节」时把导出文本发来即可"
				},
				{
					name: "autoCloseDialogs",
					label: "自动关闭普通弹窗",
					type: "switch",
					value: defaultConfig$1.autoCloseDialogs,
					desc: "默认开启：只点「确定/确认/知道了/好的/关闭」这类纯关闭词。v3.4.7 起绝不点「继续/继续学习」（站点会按自己的进度记录跳转到别的章节）、绝不碰验证码弹窗、绝不点带 nodeId 链接的按钮"
				},
				{
					name: "switchDelayMinSec",
					label: "切换间隔下限(秒)",
					type: "number",
					value: defaultConfig$1.switchDelayMinSec,
					desc: "视频播完 / 无视频 / 播放失败后，至少等待多少秒再切下一小节，默认 10 秒"
				},
				{
					name: "switchDelayMaxSec",
					label: "切换间隔上限(秒)",
					type: "number",
					value: defaultConfig$1.switchDelayMaxSec,
					desc: "至多等待多少秒再切下一小节，默认 20 秒；每节在下限~上限之间随机取一次，倒计时不抖动"
				}
			]
		},
		{
			name: "chapter",
			label: "答题配置",
			config: [
				{
					name: "autoAnswer",
					label: "自动答题",
					type: "switch",
					value: defaultConfig$1.autoAnswer,
					desc: "开启后，自动识别题目并检索答案"
				},
				{
					name: "autoSubmit",
					label: "自动提交",
					type: "switch",
					value: defaultConfig$1.autoSubmit,
					desc: "慎用：匹配率达标时会自动提交答卷"
				},
				{
					name: "minAccuracy",
					label: "最低匹配率",
					type: "input",
					value: defaultConfig$1.minAccuracy,
					desc: "不满足最低匹配率则不会自动提交答案"
				}
			]
		},
		{
			name: "exam",
			label: "考试配置",
			config: [{
				name: "autoExam",
				label: "考试自动切换",
				type: "switch",
				value: defaultConfig$1.autoExam,
				desc: "开启后，考试页面会自动切到下一题"
			}]
		}
	];
	var useformStore = pinia.defineStore({
		id: "formstore",
		state: () => ({
			forminput: getConfig(),
			dialogV: false,
			activeName: "base"
		}),
		actions: { saveConfig(forminput) {
			_GM_setValue("config", forminput);
		} }
	});
	var log = (data, type = "info") => {
		var _a;
		const style = `color: ${{
			info: "orange",
			success: "green",
			error: "red"
		}[type]}; font-weight: bold;`;
		if (Array.isArray(data) || "object" == typeof data ? console.log(`%c${JSON.stringify(data, null, 2)}`, style) : console.log(`%c${data}`, style), defaultConfig$1.debugger) {
			const caller = (((_a = new Error().stack) == null ? void 0 : _a.split("\n")) || [])[2].trim();
			console.log(`${caller}`);
		}
	};
	var sleep = (time) => new Promise((resolve) => {
		setTimeout(() => {
			resolve();
		}, 1e3 * time);
	});
	var useAskStore = pinia.defineStore({
		id: "ask",
		state: () => ({
			dialogVisible: true,
			count: 0,
			questionList: [],
			task: {
				name: "暂未加载",
				work: {
					questionList: [],
					inx: 0
				},
				video: [],
				log: [],
				status: ""
			}
		}),
		actions: {
			reset() {
				this.task.name = "暂未加载", this.task.work = {
					questionList: [],
					inx: 0
				}, this.task.video = [], this.task.status = "", this.count = 0;
			},
			select(index) {
				this.task.work.questionList[index].selected = true, this.task.work.inx = index;
				try {
					this.task.work.questionList[index].dom.scrollIntoView({ block: "center" });
				} catch (e) {
					log(e, "error");
				}
			},
			get(index) {
				return this.task.work.questionList[index];
			},
			insert(question) {
				this.task.work.questionList.push(question);
			},
			update(index, question) {
				this.task.work.questionList[index] = question;
			},
			log(msg, level = "info") {
				this.task.log.length > 20 && this.task.log.shift(), this.task.log.push({
					time: new Date().toLocaleTimeString(),
					msg,
					type: level
				});
			},
			msg(msg) {
				this.task.status = msg;
			}
		}
	});
	var POSITION_KEY = "manfen:panel-position";
	var DRAG_THRESHOLD = 5;
	function readPosition() {
		try {
			const saved = _GM_getValue(POSITION_KEY);
			if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) return saved;
		} catch {}
		return null;
	}
	function useFloatingPanel(panel, launcher, visible) {
		const saved = readPosition();
		const position = (0, vue.ref)(saved ? {
			left: `${saved.left}px`,
			top: `${saved.top}px`
		} : {
			right: "20px",
			top: "72px"
		});
		const dragging = (0, vue.ref)(false);
		let origin;
		let observer;
		let ownerWindow;
		let suppressLauncherClick = false;
		const activeElement = () => visible.value ? panel.value : launcher.value;
		function place(left, top) {
			const element = activeElement();
			if (!element?.getClientRects().length || !ownerWindow) return;
			const rect = element.getBoundingClientRect();
			const maxX = Math.max(12, ownerWindow.innerWidth - rect.width - 12);
			const maxY = Math.max(12, ownerWindow.innerHeight - rect.height - 12);
			position.value = {
				left: `${Math.max(12, Math.min(left, maxX))}px`,
				top: `${Math.max(12, Math.min(top, maxY))}px`
			};
		}
		function clamp() {
			const rect = activeElement()?.getBoundingClientRect();
			if (rect) place(rect.left, rect.top);
		}
		function observeElements() {
			observer.disconnect();
			observer.observe(panel.value);
			if (launcher.value) observer.observe(launcher.value);
		}
		function startDrag(event) {
			if (event.button !== 0 || event.isPrimary === false || origin) return;
			const isLauncher = event.currentTarget === launcher.value;
			if (!isLauncher && event.target.closest("button, a, input")) return;
			const rect = activeElement().getBoundingClientRect();
			origin = {
				pointerId: event.pointerId,
				isLauncher,
				x: event.clientX,
				y: event.clientY,
				left: rect.left,
				top: rect.top
			};
			suppressLauncherClick = false;
			event.currentTarget.setPointerCapture(event.pointerId);
		}
		function moveDrag(event) {
			if (!origin || event.pointerId !== origin.pointerId) return;
			const dx = event.clientX - origin.x;
			const dy = event.clientY - origin.y;
			if (!dragging.value && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
			dragging.value = true;
			if (origin.isLauncher) suppressLauncherClick = true;
			place(origin.left + dx, origin.top + dy);
		}
		function endDrag(event) {
			if (!origin || event.pointerId !== origin.pointerId) return;
			origin = void 0;
			const moved = dragging.value;
			dragging.value = false;
			if (!moved) return;
			try {
				_GM_setValue(POSITION_KEY, {
					left: parseFloat(position.value.left),
					top: parseFloat(position.value.top)
				});
			} catch (error) {
				console.warn("满分助手：悬浮窗位置保存失败", error);
			}
		}
		function consumeDragClick(event) {
			const ignore = suppressLauncherClick && event.detail !== 0;
			suppressLauncherClick = false;
			return ignore;
		}
		(0, vue.onMounted)(() => {
			ownerWindow = panel.value.ownerDocument.defaultView;
			ownerWindow.addEventListener("resize", clamp);
			observer = new ownerWindow.ResizeObserver(clamp);
			observeElements();
			const panelWidth = parseFloat(ownerWindow.getComputedStyle(panel.value).width) || 356;
			place(saved?.left ?? ownerWindow.innerWidth - panelWidth - 20, saved?.top ?? 72);
		});
		(0, vue.watch)(visible, async () => {
			await (0, vue.nextTick)();
			if (!observer || !panel.value) return;
			observeElements();
			clamp();
		});
		(0, vue.onBeforeUnmount)(() => {
			observer?.disconnect();
			ownerWindow?.removeEventListener("resize", clamp);
			observer = void 0;
		});
		return {
			position,
			dragging,
			startDrag,
			moveDrag,
			endDrag,
			consumeDragClick
		};
	}
	var _hoisted_1$3 = ["width", "height"];
	var _hoisted_2$3 = ["d"];
	var _sfc_main$3 = {
		__name: "Icon",
		props: {
			name: String,
			size: {
				type: Number,
				default: 18
			}
		},
		setup(__props) {
			const paths = {
				settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3l-1 3-3 1-2 3 2 2-1 4 3 2 3-1 3 3 3-1 1-3 3-1 1-3-2-2 1-4-3-2-3 1-2-2Z",
				close: "m6 6 12 12M6 18 18 6",
				minus: "M5 12h14",
				arrow: "m10 7 5 5-5 5",
				check: "m5 12 4 4L19 6",
				book: "M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4ZM12 6v15",
				clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
				play: "m9 6 10 6-10 6ZM4 5v14",
				grip: "M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01"
			};
			return (_ctx, _cache) => {
				return (0, vue.openBlock)(), (0, vue.createElementBlock)("svg", {
					width: __props.size,
					height: __props.size,
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					"stroke-width": "1.7",
					"stroke-linecap": "round",
					"stroke-linejoin": "round",
					"aria-hidden": "true"
				}, [(0, vue.createElementVNode)("path", { d: paths[__props.name] || paths.book }, null, 8, _hoisted_2$3)], 8, _hoisted_1$3);
			};
		}
	};
	var _hoisted_1$2 = (0, vue.createElementVNode)("div", { class: "mf-section-intro" }, [(0, vue.createElementVNode)("h2", null, "授权码与设置"), (0, vue.createElementVNode)("p", null, "题库授权码在下方填写，修改后自动保存。")], -1);
	var _hoisted_2$2 = {
		class: "mf-segments",
		"aria-label": "配置分类"
	};
	var _hoisted_3$2 = ["aria-pressed", "onClick"];
	var _hoisted_4$2 = { class: "mf-field-label" };
	var _hoisted_5$2 = ["for"];
	var _hoisted_6$2 = ["id"];
	var _hoisted_7$2 = [
		"id",
		"onUpdate:modelValue",
		"aria-describedby"
	];
	var _hoisted_8$2 = [
		"id",
		"onUpdate:modelValue",
		"aria-describedby",
		"aria-invalid"
	];
	var _hoisted_9$2 = [
		"id",
		"onUpdate:modelValue",
		"type",
		"placeholder",
		"aria-describedby"
	];
	var _hoisted_10$2 = {
		key: 3,
		class: "mf-error",
		role: "alert"
	};
	var _sfc_main$2 = {
		__name: "SettingsPanel",
		setup(__props) {
			const formStore = useformStore();
			const { forminput, activeName } = (0, pinia.storeToRefs)(formStore);
			const draft = (0, vue.reactive)({ ...forminput.value });
			const errors = (0, vue.ref)({});
			const hasSaved = (0, vue.ref)(false);
			const saveFailed = (0, vue.ref)(false);
			const hasErrors = (0, vue.computed)(() => Object.keys(errors.value).length > 0);
			const saveStatus = (0, vue.computed)(() => {
				if (saveFailed.value) return "自动保存失败，请继续编辑重试";
				if (hasErrors.value) return "标红项未保存，其他有效修改会自动保存";
				return hasSaved.value ? "已自动保存，刷新页面生效" : "修改后自动保存，刷新页面生效";
			});
			const isToken = (field) => field.name.endsWith("token");
			const displayGroups = userConfig.map((group) => ({
				...group,
				label: group.name === "base" ? "授权码 / 基础" : group.label.replace("配置", ""),
				config: group.name === "base" ? [...group.config.filter(isToken), ...group.config.filter((field) => !isToken(field))] : group.config
			}));
			const fieldLabel = (field) => isToken(field) ? field.label.replace("秘钥", "授权码（秘钥）") : field.label;
			function autoSave() {
				const nextErrors = {};
				for (const [key, label] of [["interval", "间隔时间"], ["answerInterval", "答题间隔"]]) {
					const value = draft[key];
					if (value === "" || value == null) nextErrors[key] = `${label}不能为空`;
					else if (typeof value !== "number" || !Number.isFinite(value)) nextErrors[key] = `${label}必须为数字`;
					else if (value < 1) nextErrors[key] = `${label}必须大于等于1`;
				}
				errors.value = nextErrors;
				const nextConfig = {
					...forminput.value,
					...draft
				};
				for (const key of Object.keys(nextErrors)) nextConfig[key] = forminput.value[key];
				if (!Object.keys(nextConfig).some((key) => !Object.is(nextConfig[key], forminput.value[key]))) {
					saveFailed.value = false;
					return;
				}
				try {
					formStore.saveConfig(nextConfig);
					Object.assign(forminput.value, nextConfig);
					hasSaved.value = true;
					saveFailed.value = false;
				} catch {
					saveFailed.value = true;
				}
			}
			(0, vue.watch)(draft, autoSave, { flush: "sync" });
			return (_ctx, _cache) => {
				return (0, vue.openBlock)(), (0, vue.createElementBlock)("form", {
					class: "mf-settings",
					onSubmit: _cache[0] || (_cache[0] = (0, vue.withModifiers)(() => {}, ["prevent"])),
					novalidate: ""
				}, [
					_hoisted_1$2,
					(0, vue.createElementVNode)("nav", _hoisted_2$2, [((0, vue.openBlock)(true), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)((0, vue.unref)(displayGroups), (group) => {
						return (0, vue.openBlock)(), (0, vue.createElementBlock)("button", {
							key: group.name,
							type: "button",
							class: (0, vue.normalizeClass)({ "is-active": (0, vue.unref)(activeName) === group.name }),
							"aria-pressed": (0, vue.unref)(activeName) === group.name,
							onClick: ($event) => activeName.value = group.name
						}, (0, vue.toDisplayString)(group.label), 11, _hoisted_3$2);
					}), 128))]),
					((0, vue.openBlock)(true), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)((0, vue.unref)(displayGroups), (group) => {
						return (0, vue.withDirectives)(((0, vue.openBlock)(), (0, vue.createElementBlock)("div", {
							key: group.name,
							class: (0, vue.normalizeClass)(["mf-fields", { "mf-fields-base": group.name === "base" }])
						}, [((0, vue.openBlock)(true), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)(group.config, (field) => {
							return (0, vue.openBlock)(), (0, vue.createElementBlock)("div", {
								key: field.name,
								class: (0, vue.normalizeClass)(["mf-field", {
									"mf-field-switch": field.type === "switch",
									"mf-field-token": isToken(field)
								}])
							}, [
								(0, vue.createElementVNode)("div", _hoisted_4$2, [(0, vue.createElementVNode)("label", { for: `mf-${field.name}` }, (0, vue.toDisplayString)(fieldLabel(field)), 9, _hoisted_5$2), (0, vue.createElementVNode)("p", { id: `mf-${field.name}-help` }, (0, vue.toDisplayString)(isToken(field) ? "选填 · 填写你获得的对应题库授权码" : field.desc), 9, _hoisted_6$2)]),
								field.type === "switch" ? (0, vue.withDirectives)(((0, vue.openBlock)(), (0, vue.createElementBlock)("input", {
									key: 0,
									id: `mf-${field.name}`,
									"onUpdate:modelValue": ($event) => draft[field.name] = $event,
									class: "mf-switch",
									type: "checkbox",
									role: "switch",
									"aria-describedby": `mf-${field.name}-help`
								}, null, 8, _hoisted_7$2)), [[vue.vModelCheckbox, draft[field.name]]]) : field.type === "number" ? (0, vue.withDirectives)(((0, vue.openBlock)(), (0, vue.createElementBlock)("input", {
									key: 1,
									id: `mf-${field.name}`,
									"onUpdate:modelValue": ($event) => draft[field.name] = $event,
									class: "mf-input",
									type: "number",
									min: "1",
									step: "1",
									"aria-describedby": `mf-${field.name}-help`,
									"aria-invalid": !!errors.value[field.name]
								}, null, 8, _hoisted_8$2)), [[
									vue.vModelText,
									draft[field.name],
									void 0,
									{ number: true }
								]]) : (0, vue.withDirectives)(((0, vue.openBlock)(), (0, vue.createElementBlock)("input", {
									key: 2,
									id: `mf-${field.name}`,
									"onUpdate:modelValue": ($event) => draft[field.name] = $event,
									class: "mf-input",
									type: isToken(field) ? "password" : "text",
									placeholder: isToken(field) ? `粘贴${field.label.replace("秘钥", "")}授权码` : "",
									autocomplete: "off",
									"aria-describedby": `mf-${field.name}-help`
								}, null, 8, _hoisted_9$2)), [[vue.vModelDynamic, draft[field.name]]]),
								errors.value[field.name] ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("p", _hoisted_10$2, (0, vue.toDisplayString)(errors.value[field.name]), 1)) : (0, vue.createCommentVNode)("", true)
							], 2);
						}), 128))], 2)), [[vue.vShow, (0, vue.unref)(activeName) === group.name]]);
					}), 128)),
					(0, vue.createElementVNode)("footer", {
						class: (0, vue.normalizeClass)(["mf-autosave", {
							"is-error": hasErrors.value || saveFailed.value,
							"is-saved": hasSaved.value && !hasErrors.value && !saveFailed.value
						}]),
						role: "status"
					}, [(0, vue.createVNode)(_sfc_main$3, {
						name: hasSaved.value && !hasErrors.value && !saveFailed.value ? "check" : "clock",
						size: 14
					}, null, 8, ["name"]), (0, vue.createElementVNode)("span", null, (0, vue.toDisplayString)(saveStatus.value), 1)], 2)
				], 32);
			};
		}
	};
	var _hoisted_1$1 = { class: "mf-task" };
	var _hoisted_2$1 = { class: "mf-task-summary" };
	var _hoisted_3$1 = { class: "mf-task-icon" };
	var _hoisted_4$1 = (0, vue.createElementVNode)("span", { class: "mf-eyebrow" }, "当前任务", -1);
	var _hoisted_5$1 = (0, vue.createElementVNode)("i", null, null, -1);
	var _hoisted_6$1 = { class: "mf-progress-row" };
	var _hoisted_7$1 = ["aria-valuenow"];
	var _hoisted_8$1 = { class: "mf-question" };
	var _hoisted_9$1 = { class: "mf-question-heading" };
	var _hoisted_10$1 = { class: "mf-eyebrow" };
	var _hoisted_11$1 = { class: "mf-answer" };
	var _hoisted_12$1 = (0, vue.createElementVNode)("span", { class: "mf-eyebrow" }, "参考答案", -1);
	var _hoisted_13$1 = { key: 0 };
	var _hoisted_14$1 = {
		key: 1,
		class: "mf-loading"
	};
	var _hoisted_15$1 = (0, vue.createElementVNode)("span", null, null, -1);
	var _hoisted_16$1 = {
		key: 0,
		class: "mf-question-section",
		"aria-label": "题号导航"
	};
	var _hoisted_17$1 = (0, vue.createElementVNode)("div", { class: "mf-section-heading" }, [(0, vue.createElementVNode)("h3", null, "题号导航"), (0, vue.createElementVNode)("span", null, "点击定位到题目")], -1);
	var _hoisted_18$1 = { class: "mf-question-grid" };
	var _hoisted_19$1 = [
		"aria-label",
		"aria-current",
		"onClick"
	];
	var _hoisted_20 = {
		key: 1,
		class: "mf-sources"
	};
	var _hoisted_21 = { class: "mf-section-heading" };
	var _hoisted_22 = (0, vue.createElementVNode)("h3", null, "题库返回", -1);
	var _hoisted_23 = ["open"];
	var _hoisted_24$1 = ["innerHTML"];
	var _hoisted_25$1 = {
		key: 0,
		class: "mf-source-usage"
	};
	var _hoisted_26$1 = { class: "mf-help" };
	var _hoisted_27$1 = {
		key: 1,
		class: "mf-empty"
	};
	var _hoisted_28$1 = { class: "mf-empty-icon" };
	var _sfc_main$1 = {
		__name: "TaskPanel",
		emits: ["open-settings"],
		setup(__props, { emit }) {
			const store = useAskStore();
			const formStore = useformStore();
			const { forminput } = (0, pinia.storeToRefs)(formStore);
			const enabled = (0, vue.computed)(() => forminput.value.enabled !== false);
			const autoPlay = (0, vue.computed)(() => forminput.value.autoVideo !== false);
			function setControl(key, value) {
				const nextConfig = { ...forminput.value, [key]: value };
				formStore.saveConfig(nextConfig);
				Object.assign(forminput.value, nextConfig);
				store.msg(key === "enabled" ? (value ? "助手已手动开启" : "助手已手动关闭") : (value ? "自动播放已开启" : "自动播放已关闭"));
				store.log(key === "enabled" ? (value ? "手动开启助手" : "手动关闭助手，自动切换已停止") : (value ? "开启自动播放" : "关闭自动播放"), "success");
			}
			const toggleEnabled = () => setControl("enabled", !enabled.value);
			const toggleAutoPlay = () => setControl("autoVideo", !autoPlay.value);
			const switchNote = (0, vue.computed)(() => {
				const lo = Number(forminput.value.switchDelayMinSec) || 10;
				const hi = Number(forminput.value.switchDelayMaxSec) || 20;
				return "切换间隔 " + Math.min(lo, hi) + "~" + Math.max(lo, hi) + " 秒";
			});
			const current = (0, vue.computed)(() => store.task.work.questionList[store.task.work.inx]);
			const answered = (0, vue.computed)(() => store.task.work.questionList.filter((item) => item.status === "primary").length);
			const completed = (0, vue.computed)(() => store.task.work.questionList.filter((item) => item.status).length);
			const percent = (0, vue.computed)(() => store.count ? Math.min(100, Math.round(completed.value / store.count * 100)) : 0);
			const answerText = (answer) => Array.isArray(answer) ? answer.join("\n") : String(answer || "");
			return (_ctx, _cache) => {
				return (0, vue.openBlock)(), (0, vue.createElementBlock)("div", _hoisted_1$1, [(0, vue.createElementVNode)("div", _hoisted_2$1, [
					(0, vue.createElementVNode)("span", _hoisted_3$1, [(0, vue.createVNode)(_sfc_main$3, {
						name: (0, vue.unref)(store).task.video.status ? "play" : "book",
						size: 20
					}, null, 8, ["name"])]),
					(0, vue.createElementVNode)("div", null, [_hoisted_4$1, (0, vue.createElementVNode)("h2", null, (0, vue.toDisplayString)((0, vue.unref)(store).task.name === "暂未加载" ? "等待任务加载" : (0, vue.unref)(store).task.name), 1)]),
					(0, vue.createElementVNode)("span", { class: (0, vue.normalizeClass)(["mf-badge", { "is-waiting": (0, vue.unref)(store).task.name === "暂未加载" }]) }, [_hoisted_5$1, (0, vue.createTextVNode)((0, vue.toDisplayString)((0, vue.unref)(store).task.name === "暂未加载" ? "等待中" : "进行中"), 1)], 2)
				]),
				(0, vue.createElementVNode)("div", { class: "mf-quick-controls", "aria-label": "视频助手快捷控制" }, [
					(0, vue.createElementVNode)("button", {
						type: "button",
						class: (0, vue.normalizeClass)(["mf-quick-button", { "is-on": enabled.value, "is-off": !enabled.value }]),
						"aria-pressed": enabled.value,
						onClick: toggleEnabled
					}, (0, vue.toDisplayString)(enabled.value ? "助手：已开启" : "助手：已关闭"), 3),
					(0, vue.createElementVNode)("button", {
						type: "button",
						class: (0, vue.normalizeClass)(["mf-quick-button", { "is-on": autoPlay.value, "is-off": !autoPlay.value }]),
						"aria-pressed": autoPlay.value,
						onClick: toggleAutoPlay
					}, (0, vue.toDisplayString)(autoPlay.value ? "自动播放：开" : "自动播放：关"), 3),
					(0, vue.createElementVNode)("span", { class: "mf-quick-note" }, (0, vue.toDisplayString)(switchNote.value), 1)
				]),
				current.value ? ((0, vue.openBlock)(), (0, vue.createElementBlock)(vue.Fragment, { key: 0 }, [
					(0, vue.createElementVNode)("div", _hoisted_6$1, [(0, vue.createElementVNode)("span", null, "已处理 " + (0, vue.toDisplayString)(completed.value) + " / " + (0, vue.toDisplayString)((0, vue.unref)(store).count) + " 题", 1), (0, vue.createElementVNode)("span", null, "已匹配 " + (0, vue.toDisplayString)(answered.value) + " 题", 1)]),
					(0, vue.createElementVNode)("div", {
						class: "mf-progress",
						role: "progressbar",
						"aria-label": "题目处理进度",
						"aria-valuenow": percent.value,
						"aria-valuemin": "0",
						"aria-valuemax": "100"
					}, [(0, vue.createElementVNode)("span", { style: (0, vue.normalizeStyle)({ width: `${percent.value}%` }) }, null, 4)], 8, _hoisted_7$1),
					(0, vue.createElementVNode)("article", _hoisted_8$1, [
						(0, vue.createElementVNode)("div", _hoisted_9$1, [(0, vue.createElementVNode)("span", _hoisted_10$1, "第 " + (0, vue.toDisplayString)((0, vue.unref)(store).task.work.inx + 1) + " 题", 1), (0, vue.createElementVNode)("span", { class: (0, vue.normalizeClass)(["mf-answer-status", current.value.status]) }, (0, vue.toDisplayString)(current.value.status === "primary" ? "已匹配答案" : current.value.status === "danger" ? "暂无答案" : "正在检索"), 3)]),
						(0, vue.createElementVNode)("h3", null, (0, vue.toDisplayString)(current.value.question), 1),
						(0, vue.createElementVNode)("div", _hoisted_11$1, [_hoisted_12$1, current.value.answer ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("pre", _hoisted_13$1, (0, vue.toDisplayString)(answerText(current.value.answer)), 1)) : ((0, vue.openBlock)(), (0, vue.createElementBlock)("div", _hoisted_14$1, [_hoisted_15$1, (0, vue.createTextVNode)("正在检索题库，请稍候…")]))])
					]),
					(0, vue.unref)(store).task.name !== "考试" ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("section", _hoisted_16$1, [_hoisted_17$1, (0, vue.createElementVNode)("div", _hoisted_18$1, [((0, vue.openBlock)(true), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)((0, vue.unref)(store).task.work.questionList, (question, index) => {
						return (0, vue.openBlock)(), (0, vue.createElementBlock)("button", {
							key: index,
							type: "button",
							class: (0, vue.normalizeClass)([question.status, { "is-current": (0, vue.unref)(store).task.work.inx === index }]),
							"aria-label": `查看第 ${index + 1} 题`,
							"aria-current": (0, vue.unref)(store).task.work.inx === index ? "true" : void 0,
							onClick: ($event) => (0, vue.unref)(store).select(index)
						}, (0, vue.toDisplayString)(index + 1), 11, _hoisted_19$1);
					}), 128))])])) : (0, vue.createCommentVNode)("", true),
					current.value.allAnswer ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("section", _hoisted_20, [
						(0, vue.createElementVNode)("div", _hoisted_21, [_hoisted_22, (0, vue.createElementVNode)("button", {
							type: "button",
							class: "mf-auth-link",
							onClick: _cache[0] || (_cache[0] = ($event) => emit("open-settings"))
						}, [(0, vue.createTextVNode)(" 填写授权码"), (0, vue.createVNode)(_sfc_main$3, {
							name: "arrow",
							size: 12
						})])]),
						((0, vue.openBlock)(true), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)(current.value.allAnswer, (source, index) => {
							return (0, vue.openBlock)(), (0, vue.createElementBlock)("details", {
								key: index,
								open: index === 0
							}, [
								(0, vue.createElementVNode)("summary", null, [
									(0, vue.createTextVNode)((0, vue.toDisplayString)(source.form), 1),
									(0, vue.createElementVNode)("span", null, (0, vue.toDisplayString)(source.answer?.length ? "查看结果" : "暂无答案"), 1),
									(0, vue.createVNode)(_sfc_main$3, {
										name: "arrow",
										size: 14
									})
								]),
								(0, vue.createElementVNode)("div", {
									class: "mf-source-answer",
									innerHTML: answerText(source.answer) || "暂无答案"
								}, null, 8, _hoisted_24$1),
								source.num != null ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("div", _hoisted_25$1, [(0, vue.createElementVNode)("span", null, "已用 " + (0, vue.toDisplayString)(source.usenum), 1), (0, vue.createElementVNode)("span", null, "剩余 " + (0, vue.toDisplayString)(source.num), 1)])) : (0, vue.createCommentVNode)("", true)
							], 8, _hoisted_23);
						}), 128)),
						(0, vue.createElementVNode)("p", _hoisted_26$1, (0, vue.toDisplayString)(current.value.allAnswer.length) + " 个题库来源 · 授权码自动保存，刷新页面生效。 ", 1)
					])) : (0, vue.createCommentVNode)("", true)
				], 64)) : ((0, vue.openBlock)(), (0, vue.createElementBlock)("div", _hoisted_27$1, [
					(0, vue.createElementVNode)("div", _hoisted_28$1, [(0, vue.createVNode)(_sfc_main$3, {
						name: (0, vue.unref)(store).task.video.status ? "play" : "clock",
						size: 30
					}, null, 8, ["name"])]),
					(0, vue.createElementVNode)("h3", null, (0, vue.toDisplayString)((0, vue.unref)(store).task.video.status ? "正在完成视频任务" : "准备就绪，等待任务"), 1),
					(0, vue.createElementVNode)("p", null, (0, vue.toDisplayString)((0, vue.unref)(store).task.video.status ? "视频运行状态可在日志中查看。" : "进入章节、作业或考试页面后，任务进度会显示在这里。"), 1)
				]))]);
			};
		}
	};
	var _hoisted_1 = ["onKeydown"];
	var _hoisted_2 = { class: "mf-brand" };
	var _hoisted_3 = { class: "mf-brand-text" };
	var _hoisted_4 = (0, vue.createElementVNode)("h1", null, [(0, vue.createTextVNode)("满分助手"), (0, vue.createElementVNode)("span", null, "haiqikeji")], -1);
	var _hoisted_5 = { class: "mf-window-actions" };
	var _hoisted_6 = ["aria-label", "title"];
	var _hoisted_7 = {
		key: 0,
		class: "mf-tabs",
		"aria-label": "助手内容"
	};
	var _hoisted_8 = ["aria-pressed", "onClick"];
	var _hoisted_9 = {
		key: 0,
		class: "mf-tab-count"
	};
	var _hoisted_10 = { class: "mf-body" };
	var _hoisted_11 = {
		key: 1,
		class: "mf-logs",
		"aria-label": "运行日志"
	};
	var _hoisted_12 = { class: "mf-section-heading" };
	var _hoisted_13 = (0, vue.createElementVNode)("h2", null, "运行记录", -1);
	var _hoisted_14 = {
		key: 0,
		class: "mf-empty"
	};
	var _hoisted_15 = (0, vue.createElementVNode)("h3", null, "还没有运行记录", -1);
	var _hoisted_16 = (0, vue.createElementVNode)("p", null, "任务开始后，日志会出现在这里。", -1);
	var _hoisted_17 = { key: 1 };
	var _hoisted_18 = (0, vue.createElementVNode)("span", { class: "mf-log-dot" }, null, -1);
	var _hoisted_19 = {
		key: 2,
		class: "mf-notice"
	};
	var _hoisted_24 = [
		(0, vue.createElementVNode)("span", { class: "mf-eyebrow" }, "使用公告", -1),
		(0, vue.createElementVNode)("h2", null, "本脚本仅用于学习交流，请24h内删除", -1),
		(0, vue.createElementVNode)("p", null, "禁止用于各种非法用途，否则后果自负。", -1),
		(0, vue.createElementVNode)("p", null, " 本脚本题库接口均来源于网络以及用户反馈添加，不对题库准确率以及可用性负责，请自行判断、评估是否使用。 ", -1)
	];
	var _hoisted_25 = { class: "mf-panel-footer" };
	var _hoisted_26 = { class: "mf-footer-status" };
	var _hoisted_27 = (0, vue.createElementVNode)("i", null, null, -1);
	var _hoisted_28 = (0, vue.createElementVNode)("span", { class: "mf-version" }, "v3.2.2", -1);
	var _hoisted_29 = ["aria-label", "title"];
	var _hoisted_30 = { class: "mf-launcher-icon" };
	var _sfc_main = {
		__name: "App",
		props: { taskMode: Boolean },
		setup(__props) {
			const props = __props;
			const askStore = useAskStore();
			const { task, dialogVisible } = (0, pinia.storeToRefs)(askStore);
			const { dialogV, activeName } = (0, pinia.storeToRefs)(useformStore());
			const activeTab = (0, vue.ref)("task");
			const panel = (0, vue.ref)(null);
			const launcher = (0, vue.ref)(null);
			const visible = (0, vue.computed)(() => dialogV.value || props.taskMode && dialogVisible.value);
			const { position, dragging, startDrag, moveDrag, endDrag, consumeDragClick } = useFloatingPanel(panel, launcher, visible);
			const tabs = [
				{
					id: "task",
					label: "运行状态"
				},
				{
					id: "logs",
					label: "运行日志"
				},
				{
					id: "notice",
					label: "公告"
				}
			];
			function closePanel() {
				dialogV.value = false;
				dialogVisible.value = false;
			}
			function openPanel(event) {
				if (consumeDragClick(event)) {
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				props.taskMode ? dialogVisible.value = true : openSettings();
			}
			function openSettings() {
				activeName.value = "base";
				dialogV.value = true;
			}
			function toggleSettings() {
				dialogV.value ? dialogV.value = false : openSettings();
			}
			return (_ctx, _cache) => {
				return (0, vue.openBlock)(), (0, vue.createElementBlock)(vue.Fragment, null, [(0, vue.withDirectives)((0, vue.createElementVNode)("section", {
					ref_key: "panel",
					ref: panel,
					class: (0, vue.normalizeClass)(["mf-panel", { "is-dragging": (0, vue.unref)(dragging) }]),
					style: (0, vue.normalizeStyle)((0, vue.unref)(position)),
					"aria-label": "满分助手",
					onKeydown: (0, vue.withKeys)((0, vue.withModifiers)(closePanel, ["stop"]), ["esc"])
				}, [
					(0, vue.createElementVNode)("header", {
						class: "mf-header",
						onPointerdown: _cache[0] || (_cache[0] = (...args) => (0, vue.unref)(startDrag) && (0, vue.unref)(startDrag)(...args)),
						onPointermove: _cache[1] || (_cache[1] = (...args) => (0, vue.unref)(moveDrag) && (0, vue.unref)(moveDrag)(...args)),
						onPointerup: _cache[2] || (_cache[2] = (...args) => (0, vue.unref)(endDrag) && (0, vue.unref)(endDrag)(...args)),
						onPointercancel: _cache[3] || (_cache[3] = (...args) => (0, vue.unref)(endDrag) && (0, vue.unref)(endDrag)(...args)),
						onLostpointercapture: _cache[4] || (_cache[4] = (...args) => (0, vue.unref)(endDrag) && (0, vue.unref)(endDrag)(...args))
					}, [
						(0, vue.createElementVNode)("span", _hoisted_2, [(0, vue.createVNode)(_sfc_main$3, {
							name: "check",
							size: 22
						})]),
						(0, vue.createElementVNode)("div", _hoisted_3, [_hoisted_4, (0, vue.createElementVNode)("p", null, (0, vue.toDisplayString)((0, vue.unref)(dialogV) ? "授权码与学习偏好" : "学习进度，一目了然"), 1)]),
						(0, vue.createElementVNode)("div", _hoisted_5, [__props.taskMode ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("button", {
							key: 0,
							type: "button",
							class: (0, vue.normalizeClass)(["mf-settings-button", { "is-active": (0, vue.unref)(dialogV) }]),
							"aria-label": (0, vue.unref)(dialogV) ? "返回任务" : "设置 / 授权码",
							title: (0, vue.unref)(dialogV) ? "返回任务" : "设置 / 授权码",
							onClick: toggleSettings
						}, [(0, vue.createVNode)(_sfc_main$3, {
							name: (0, vue.unref)(dialogV) ? "book" : "settings",
							size: 14
						}, null, 8, ["name"]), (0, vue.createElementVNode)("span", null, (0, vue.toDisplayString)((0, vue.unref)(dialogV) ? "返回任务" : "设置 / 授权码"), 1)], 10, _hoisted_6)) : (0, vue.createCommentVNode)("", true), (0, vue.createElementVNode)("button", {
							type: "button",
							class: "mf-icon-button",
							"aria-label": "收起面板",
							title: "收起面板",
							onClick: closePanel
						}, [(0, vue.createVNode)(_sfc_main$3, { name: "minus" })])])
					], 32),
					!(0, vue.unref)(dialogV) && __props.taskMode ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("nav", _hoisted_7, [((0, vue.openBlock)(), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)(tabs, (tab) => {
						return (0, vue.createElementVNode)("button", {
							key: tab.id,
							type: "button",
							class: (0, vue.normalizeClass)({ "is-active": activeTab.value === tab.id }),
							"aria-pressed": activeTab.value === tab.id,
							onClick: ($event) => activeTab.value = tab.id
						}, [(0, vue.createTextVNode)((0, vue.toDisplayString)(tab.label), 1), tab.id === "logs" && (0, vue.unref)(task).log.length ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("span", _hoisted_9, (0, vue.toDisplayString)((0, vue.unref)(task).log.length), 1)) : (0, vue.createCommentVNode)("", true)], 10, _hoisted_8);
					}), 64))])) : (0, vue.createCommentVNode)("", true),
					(0, vue.createElementVNode)("div", _hoisted_10, [(0, vue.unref)(dialogV) ? ((0, vue.openBlock)(), (0, vue.createBlock)(_sfc_main$2, { key: 0 })) : __props.taskMode ? ((0, vue.openBlock)(), (0, vue.createElementBlock)(vue.Fragment, { key: 1 }, [activeTab.value === "task" ? ((0, vue.openBlock)(), (0, vue.createBlock)(_sfc_main$1, {
						key: 0,
						onOpenSettings: openSettings
					})) : activeTab.value === "logs" ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("section", _hoisted_11, [(0, vue.createElementVNode)("div", _hoisted_12, [_hoisted_13, (0, vue.createElementVNode)("span", null, (0, vue.toDisplayString)((0, vue.unref)(task).log.length) + " 条", 1)]), !(0, vue.unref)(task).log.length ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("div", _hoisted_14, [
						(0, vue.createVNode)(_sfc_main$3, {
							name: "clock",
							size: 28
						}),
						_hoisted_15,
						_hoisted_16
					])) : ((0, vue.openBlock)(), (0, vue.createElementBlock)("ol", _hoisted_17, [((0, vue.openBlock)(true), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)((0, vue.unref)(task).log, (entry, index) => {
						return (0, vue.openBlock)(), (0, vue.createElementBlock)("li", {
							key: index,
							class: (0, vue.normalizeClass)(entry.type)
						}, [_hoisted_18, (0, vue.createElementVNode)("div", null, [(0, vue.createElementVNode)("time", null, (0, vue.toDisplayString)(entry.time), 1), (0, vue.createElementVNode)("p", null, (0, vue.toDisplayString)(entry.msg), 1)])], 2);
					}), 128))]))])) : ((0, vue.openBlock)(), (0, vue.createElementBlock)("section", _hoisted_19, _hoisted_24))], 64)) : (0, vue.createCommentVNode)("", true)]),
					(0, vue.createElementVNode)("footer", _hoisted_25, [(0, vue.createElementVNode)("span", _hoisted_26, [_hoisted_27, (0, vue.createTextVNode)((0, vue.toDisplayString)(__props.taskMode && (0, vue.unref)(task).status ? (0, vue.unref)(task).status : "面板外可正常点击与滚动"), 1)]), _hoisted_28])
				], 46, _hoisted_1), [[vue.vShow, visible.value]]), !visible.value ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("button", {
					key: 0,
					ref_key: "launcher",
					ref: launcher,
					class: (0, vue.normalizeClass)(["mf-launcher", { "is-dragging": (0, vue.unref)(dragging) }]),
					style: (0, vue.normalizeStyle)((0, vue.unref)(position)),
					type: "button",
					"aria-label": __props.taskMode ? "展开满分助手" : "设置 / 授权码",
					title: __props.taskMode ? "拖动调整位置，点击展开" : "拖动调整位置，点击打开设置",
					onPointerdown: _cache[5] || (_cache[5] = (...args) => (0, vue.unref)(startDrag) && (0, vue.unref)(startDrag)(...args)),
					onPointermove: _cache[6] || (_cache[6] = (...args) => (0, vue.unref)(moveDrag) && (0, vue.unref)(moveDrag)(...args)),
					onPointerup: _cache[7] || (_cache[7] = (...args) => (0, vue.unref)(endDrag) && (0, vue.unref)(endDrag)(...args)),
					onPointercancel: _cache[8] || (_cache[8] = (...args) => (0, vue.unref)(endDrag) && (0, vue.unref)(endDrag)(...args)),
					onLostpointercapture: _cache[9] || (_cache[9] = (...args) => (0, vue.unref)(endDrag) && (0, vue.unref)(endDrag)(...args)),
					onClick: openPanel
				}, [
					(0, vue.createElementVNode)("span", _hoisted_30, [(0, vue.createVNode)(_sfc_main$3, {
						name: "check",
						size: 22
					})]),
					(0, vue.createElementVNode)("span", null, [(0, vue.createTextVNode)("满分助手"), (0, vue.createElementVNode)("small", null, (0, vue.toDisplayString)(__props.taskMode ? (0, vue.unref)(task).name !== "暂未加载" ? (0, vue.unref)(task).name : "点击展开" : "设置 / 授权码"), 1)]),
					(0, vue.createVNode)(_sfc_main$3, {
						name: "arrow",
						size: 16
					})
				], 46, _hoisted_29)) : (0, vue.createCommentVNode)("", true)], 64);
			};
		}
	};
	var panel_default = ":host{all:initial;--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light;--mf-accent:#16856c;--mf-accent-dark:#106850;--mf-ink:#213c35;--mf-muted:#738279;--mf-line:#e8eeeb;color:var(--mf-ink);text-align:left;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Microsoft YaHei,sans-serif;font-size:13px;font-weight:400;line-height:1.6}*,:before,:after{box-sizing:border-box}.mf-root{pointer-events:none}button,input{font:inherit}button{color:inherit;cursor:pointer}button,input,summary{-webkit-tap-highlight-color:transparent}button{background:0 0;border:0;margin:0}button:focus-visible{outline-offset:3px;outline:3px solid #93d6c4}input:focus-visible{outline-offset:3px;outline:3px solid #93d6c4}summary:focus-visible{outline-offset:3px;outline:3px solid #93d6c4}h1,h2,h3,p,pre{margin:0}svg{vertical-align:middle;flex-shrink:0}.mf-panel{width:min(356px,100vw - 24px);max-height:min(760px,100vh - 24px);pointer-events:auto;isolation:isolate;background:#fff;border:1px solid #d9e4def2;border-radius:16px;flex-direction:column;max-height:min(760px,100dvh - 24px);display:flex;position:fixed;overflow:hidden;box-shadow:0 16px 48px -14px #173e3230,0 3px 12px #173e320d}.mf-header{cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;background:linear-gradient(115deg,#f7fbf8,#fff 80%);flex-shrink:0;align-items:center;gap:9px;padding:15px 14px;display:flex}.is-dragging .mf-header{cursor:grabbing}.mf-brand{color:#fff;background:var(--mf-accent);border-radius:10px;flex-shrink:0;place-items:center;width:34px;height:34px;display:grid;box-shadow:0 3px 8px #16856c26}.mf-brand-text{flex:1;min-width:0}.mf-brand-text h1{letter-spacing:.3px;white-space:nowrap;align-items:center;gap:6px;font-size:15px;font-weight:700;display:flex}.mf-brand-text h1 span{color:#648375;border:1px solid #d8e7df;border-radius:4px;padding:0 5px;font-size:10px;font-weight:500}.mf-brand-text p{color:#6f8176;letter-spacing:.3px;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;font-size:11px;overflow:hidden}.mf-window-actions{flex-shrink:0;align-items:center;gap:4px;display:flex}.mf-settings-button{min-height:30px;color:var(--mf-accent-dark);white-space:nowrap;background:#eaf6ef;border:1px solid #cce5d9;border-radius:8px;justify-content:center;align-items:center;gap:4px;padding:5px 7px;font-size:11px;font-weight:600;line-height:18px;transition:background .15s,border-color .15s;display:inline-flex}.mf-settings-button:hover,.mf-settings-button.is-active{background:#dcefe4;border-color:#add7c3}.mf-settings-button>svg{width:15px;height:15px}.mf-icon-button{color:#6e8277;border-radius:8px;place-items:center;width:28px;height:30px;transition:background .15s,color .15s;display:grid}.mf-icon-button:hover,.mf-icon-button.is-active{color:var(--mf-accent);background:#eaf5ef}.mf-tabs{border-bottom:1px solid var(--mf-line);flex-shrink:0;gap:22px;padding:0 16px;display:flex}.mf-tabs>button{color:#728078;white-space:nowrap;border-bottom:2px solid #0000;align-items:center;gap:5px;padding:9px 0 10px;font-size:12px;display:flex}.mf-tabs>button.is-active{border-bottom-color:var(--mf-accent);color:var(--mf-accent);font-weight:600}.mf-tab-count{font-variant-numeric:tabular-nums;background:#eff3f0;border-radius:5px;padding:0 5px;font-size:10px;line-height:16px}.mf-body{overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#cbdcd2 transparent;min-height:0;overflow-y:auto}.mf-task,.mf-logs,.mf-notice,.mf-settings{padding:16px}.mf-quick-controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:11px 14px;border-bottom:1px solid var(--mf-line);background:#f8fbf9}.mf-quick-button{border:1px solid #d8e5de;border-radius:8px;padding:6px 9px;font-size:12px;font-weight:600;background:#fff;transition:background .15s,color .15s,border-color .15s}.mf-quick-button.is-on{color:#fff;background:var(--mf-accent);border-color:var(--mf-accent)}.mf-quick-button.is-off{color:#6b7c73;background:#f1f4f2}.mf-quick-note{color:var(--mf-muted);font-size:11px;margin-left:auto}.mf-task-summary{align-items:center;gap:9px;display:flex}.mf-task-icon{color:var(--mf-accent);background:#eff6f1;border:1px solid #e6efe9;border-radius:10px;flex-shrink:0;place-items:center;width:40px;height:40px;display:grid}.mf-eyebrow{color:#72847a;letter-spacing:.8px;font-size:10px}.mf-task-summary h2{margin-top:1px;font-size:15px;font-weight:600}.mf-badge{color:var(--mf-accent);white-space:nowrap;background:#eef7f1;border-radius:20px;align-items:center;gap:5px;margin-left:auto;padding:3px 8px;font-size:10px;display:inline-flex}.mf-badge i,.mf-footer-status i{background:#48a681;border-radius:50%;flex-shrink:0;width:5px;height:5px}.mf-badge.is-waiting{color:#927e4c;background:#f8f4e9}.mf-badge.is-waiting i{background:#b49c5f}.mf-progress-row{color:#728078;justify-content:space-between;margin-top:16px;font-size:10px;display:flex}.mf-progress-row span:last-child{color:#5f8c78}.mf-progress{background:#edf3ee;border-radius:5px;height:5px;margin-top:6px;overflow:hidden}.mf-progress>span{border-radius:inherit;background:#399b7a;height:100%;transition:width .25s;display:block}.mf-question{border:1px solid #e3ebe5;border-radius:10px;margin-top:15px;padding:12px}.mf-question-heading{justify-content:space-between;align-items:center;gap:12px;display:flex}.mf-answer-status{color:#728078;font-size:10px}.mf-answer-status.primary{color:var(--mf-accent)}.mf-answer-status.danger{color:#c26b57}.mf-question h3{overflow-wrap:anywhere;margin-top:8px;font-size:13px;font-weight:500;line-height:1.75}.mf-answer{background:#f4f8f4;border-radius:7px;margin-top:11px;padding:9px 10px}.mf-answer pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#39715b;margin-top:4px;font-family:inherit;font-size:12px}.mf-loading{color:#708274;align-items:center;gap:7px;margin-top:6px;font-size:11px;display:flex}.mf-loading>span{background:#91b69f;border-radius:50%;width:6px;height:6px}.mf-question-section,.mf-sources{margin-top:17px}.mf-section-heading{justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;display:flex}.mf-section-heading h2,.mf-section-heading h3{font-size:12px;font-weight:600}.mf-section-heading>span{color:#748477;font-size:10px}.mf-auth-link{color:var(--mf-accent-dark);white-space:nowrap;background:#eef7f2;border-radius:5px;align-items:center;gap:4px;padding:3px 6px;font-size:11px;font-weight:500;line-height:18px;transition:background .15s;display:inline-flex}.mf-auth-link:hover{background:#dcefe4}.mf-question-grid{scrollbar-width:thin;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;max-height:120px;padding:2px;display:grid;overflow-y:auto}.mf-question-grid>button{color:#75867b;background:#f4f6f4;border:1px solid #e9ede8;border-radius:6px;height:28px;font-size:11px}.mf-question-grid>button.primary{color:#41816a;background:#edf6ef;border-color:#d9eadf}.mf-question-grid>button.danger{color:#bf8057;background:#fcf1ea;border-color:#f0e0d0}.mf-question-grid>button.is-current{background:var(--mf-accent);border-color:var(--mf-accent);color:#fff}.mf-question-grid>button:hover{box-shadow:0 0 0 2px #16856c24}.mf-sources details{border:1px solid var(--mf-line);border-radius:8px;margin-top:6px;padding:0 10px;overflow:hidden}.mf-sources summary{cursor:pointer;align-items:center;gap:5px;padding:8px 0;font-size:11px;list-style:none;display:flex}.mf-sources summary::-webkit-details-marker{display:none}.mf-sources summary>span{color:#768479;margin-left:auto;font-size:10px}.mf-sources details[open] summary>svg{transform:rotate(90deg)}.mf-source-answer{border-top:1px solid var(--mf-line);color:#68796d;overflow-wrap:anywhere;white-space:pre-wrap;padding:10px 0;font-size:11px;line-height:1.8}.mf-source-answer img{max-width:100%;height:auto}.mf-source-answer a{color:var(--mf-accent)}.mf-source-usage{color:#708175;gap:12px;padding-bottom:8px;font-size:10px;display:flex}.mf-help{color:#738376;margin-top:9px;font-size:10px;line-height:1.7}.mf-empty{text-align:center;color:#819487;padding:28px 12px 24px}.mf-empty-icon{color:#9bb4a3;background:#f7faf6;border:1px dashed #d4e4d8;border-radius:20px;place-items:center;width:60px;height:60px;margin:0 auto 14px;display:grid}.mf-empty h3{color:#587564;margin:12px 0 8px;font-size:13px;font-weight:500}.mf-empty p{color:#768777;max-width:235px;margin:auto;font-size:11px;line-height:1.9}.mf-panel-footer{border-top:1px solid var(--mf-line);background:#fbfcfa;flex-shrink:0;align-items:center;gap:15px;padding:9px 14px;display:flex}.mf-footer-status{color:#738578;overflow-wrap:anywhere;align-items:center;gap:6px;font-size:10px;display:flex}.mf-footer-status i{background:#99b4a0}.mf-version{color:#839287;white-space:nowrap;margin-left:auto;font-size:10px}.mf-logs ol{margin:0;padding:0;list-style:none}.mf-logs li{gap:9px;padding:0 0 16px;display:flex;position:relative}.mf-logs li:not(:last-child):before{content:\"\";background:#e8ede6;width:1px;position:absolute;top:13px;bottom:0;left:3px}.mf-log-dot{background:#b6c4b5;border-radius:50%;flex-shrink:0;width:7px;height:7px;margin-top:7px}.mf-logs .success .mf-log-dot{background:#61a17d}.mf-logs .error .mf-log-dot,.mf-logs .danger .mf-log-dot{background:#d59c84}.mf-logs time{color:#7b8b7b;font-variant-numeric:tabular-nums;font-size:10px}.mf-logs li p{color:#617363;overflow-wrap:anywhere;margin-top:3px;font-size:12px}.mf-notice h2{margin:10px 0 18px;font-size:15px;line-height:1.8}.mf-notice p{color:#71826d;margin:10px 0;font-size:12px;line-height:2}.mf-section-intro h2{font-size:15px;font-weight:600}.mf-section-intro p{color:#72826d;margin-top:4px;font-size:11px}.mf-segments{background:#f2f5ef;border-radius:9px;gap:4px;margin-top:16px;padding:4px;display:flex}.mf-segments button{color:#6f8168;border-radius:6px;flex:1;padding:6px 3px;font-size:11px}.mf-segments button.is-active{color:var(--mf-accent);background:#fff;box-shadow:0 1px 4px #233e2210}.mf-fields{padding-top:5px}.mf-field{padding-top:12px}.mf-fields-base{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:12px;display:grid}.mf-fields-base .mf-field{min-width:0}.mf-fields-base .mf-field-token{grid-column:1/-1}.mf-field-token+.mf-field-token{margin-top:1px}.mf-field-label label{font-size:12px;font-weight:500;display:block}.mf-field-label p{color:#77866f;margin-top:3px;font-size:10px;line-height:1.6}.mf-input{color:#3b5136;background:#fff;border:1px solid #dfe7da;border-radius:7px;width:100%;min-width:0;height:34px;margin-top:7px;padding:6px 9px;font-size:12px;transition:border-color .15s}.mf-input::placeholder{color:#899680}.mf-input:focus{border-color:var(--mf-accent);outline:none;box-shadow:0 0 0 3px #16856c14}.mf-input[aria-invalid=true]{border-color:#c97660}.mf-field-switch{border-bottom:1px solid #eff2eb;justify-content:space-between;align-items:center;gap:16px;padding:13px 0;display:flex}.mf-switch{-webkit-appearance:none;appearance:none;cursor:pointer;background:#d9e1d5;border-radius:20px;flex-shrink:0;width:34px;height:20px;margin:0;transition:background .15s;position:relative}.mf-switch:after{content:\"\";background:#fff;border-radius:50%;width:14px;height:14px;transition:transform .15s;position:absolute;top:3px;left:3px;box-shadow:0 1px 3px #0002}.mf-switch:checked{background:var(--mf-accent)}.mf-switch:checked:after{transform:translate(14px)}.mf-error{color:#ba604d;margin-top:5px;font-size:11px}.mf-autosave{border-top:1px solid var(--mf-line);color:#6f8067;align-items:center;gap:7px;margin-top:18px;padding-top:14px;font-size:11px;display:flex}.mf-autosave.is-saved{color:var(--mf-accent)}.mf-autosave.is-error{color:#ba604d}.mf-launcher{cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;pointer-events:auto;text-align:left;background:#fff;border:1px solid #dce9df;border-radius:12px;align-items:center;gap:8px;width:max-content;max-width:calc(100vw - 24px);padding:9px 11px 9px 9px;font-size:12px;display:flex;position:fixed;box-shadow:0 5px 24px #153b2720}.mf-launcher.is-dragging{cursor:grabbing}.mf-launcher:hover{border-color:#b5d7c5;box-shadow:0 5px 26px #153b2730}.mf-launcher-icon{background:var(--mf-accent);color:#fff;border-radius:9px;place-items:center;width:32px;height:32px;display:grid}.mf-launcher small{color:#75876f;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;font-size:10px;display:block;overflow:hidden}.mf-launcher>span:not(.mf-launcher-icon){min-width:0}.mf-launcher>svg{color:#81957a}@media (max-width:420px){.mf-task,.mf-settings,.mf-logs,.mf-notice{padding:14px}.mf-header{padding:14px 12px}.mf-tabs{gap:20px;padding:0 14px}.mf-question-grid{gap:5px}}@media (max-width:360px){.mf-header{gap:7px}.mf-brand-text h1 span{display:none}.mf-settings-button{padding-inline-start:6px;padding-inline-end:6px}}@media (prefers-reduced-motion:reduce){*,:before,:after{transition:none!important}}";
	/* ============================================================
	 *  4. 面板挂载（单实例）
	 *     原脚本用 postMessage 在多个 iframe 之间选举“谁来显示面板”，
	 *     那是为超星的多层 iframe 结构准备的。海旗是单页应用，
	 *     这里改为单实例挂载：页面变化时按需切换 task / settings 两种模式。
	 * ============================================================ */
	var SETTINGS_HOST = "manfen-settings-root";
	var TASK_HOST = "manfen-task-root";
	var piniaInstance = pinia.createPinia();
	var ui = {
		mode: null,
		host: null,
		app: null,
		form: null,
		ask: null
	};
	function unmountUi() {
		if (ui.app) {
			try {
				ui.app.unmount();
			} catch (e) {}
		}
		if (ui.host) {
			try {
				ui.host.remove();
			} catch (e) {}
		}
		ui.app = null;
		ui.host = null;
		ui.mode = null;
	}
	function mountUi(taskMode) {
		unmountUi();
		var host = document.createElement("div");
		host.id = taskMode ? TASK_HOST : SETTINGS_HOST;
		host.style.cssText = "position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important;z-index:2147483000!important;";
		var shadow = host.attachShadow({ mode: "open" });
		var style = document.createElement("style");
		style.textContent = panel_default;
		var root = document.createElement("div");
		root.className = "mf-root";
		shadow.append(style, root);
		document.body.append(host);
		var app = vue.createApp(_sfc_main, { taskMode }).use(piniaInstance);
		app.mount(root);
		ui.mode = taskMode ? "task" : "settings";
		ui.host = host;
		ui.app = app;
		ui.form = useformStore(piniaInstance);
		ui.ask = useAskStore(piniaInstance);
		return ui;
	}
	function ensureUi(mode) {
		var want = mode === "task" ? "task" : "settings";
		if (ui.mode === want && ui.host && ui.host.isConnected) return ui;
		return mountUi(want === "task");
	}
	function allowCopy() {
		(() => {
			document.body.oncopy = null, document.body.oncut = null, document.body.onpaste = null, document.body.onselectstart = null, document.body.ondragstart = null;
			const style = document.createElement("style");
			style.innerHTML = "\n       * {\n           -webkit-user-select: auto !important;\n           -moz-user-select: auto !important;\n           -o-user-select: auto !important;\n           user-select: auto !important;\n       }\n   ", document.head.appendChild(style);
		})();
	}
	var __defProp = Object.defineProperty;
	var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, {
		enumerable: true,
		configurable: true,
		writable: true,
		value
	}) : obj[key] = value;
	var __publicField = (obj, key, value) => {
		__defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
		return value;
	};
	var questionType = {
		"单选题": "0",
		"多选题": "1",
		"填空题": "2",
		"判断题": "3",
		"简答题": "4",
		"名词解释": "5",
		"论述题": "6",
		"计算题": "7"
	};
	var removeHtml = (html) => null == html ? "" : html.replace(/<((?!img|sub|sup|br)[^>]+)>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").replace(/<br\s*\/?>/g, "\n").replace(/<img.*?src="(.*?)".*?>/g, "<img src=\"$1\"/>").trim();
	var cl = (str) => str.replace(/^【.*?】\s*/, "").replace(/\s*（\d+\.\d+分）$/, "");
	/* ============================================================
	 *  5. 题库接口层（跨域请求）
	 *     原脚本混用 http:// 接口、jQuery、UE 编辑器、超星 cookie，
	 *     这里改成：全部 https + 统一 GM_xmlhttpRequest + 容错解析。
	 * ============================================================ */
	var BANK = {
		tikuhai: "https://api.tikuhai.com/search",
		yizhi: "http://cx.icodef.com/wyn-nb?v=4",
		yanxi: "https://tk.enncy.cn/query",
		muketool: "https://api.muketool.com/cx/v2/query"
	};
	var ServerApi = class {
		constructor() {
			__publicField(this, "timeout", 12e3);
		}
		request(url, method, data, headers) {
			var payload = method === "POST" ? JSON.stringify(data == null ? {} : data) : void 0;
			return new Promise((resolve, reject) => {
				_GM_xmlhttpRequest({
					method,
					url,
					data: payload,
					headers: headers || {},
					timeout: this.timeout,
					onload: (res) => {
						resolve(res);
					},
					ontimeout: () => {
						reject(new Error("请求超时"));
					},
					onerror: (err) => {
						reject(err instanceof Error ? err : new Error("网络错误"));
					}
				});
			});
		}
		static json(res) {
			try {
				return JSON.parse(res.responseText);
			} catch (e) {
				return null;
			}
		}
		// 题库海
		async tikuhai(question) {
			try {
				var res = await this.request(BANK.tikuhai, "POST", {
					key: getConfig().thtoken || "",
					question: question.question,
					options: question.options,
					type: question.type
				}, {
					"Content-Type": "application/json",
					v: SCRIPT_VERSION
				});
				var data = ServerApi.json(res);
				if (!data || typeof data !== "object") return { form: "题库海", answer: "" };
				var body = data.data && typeof data.data === "object" ? data.data : {};
				if (data.code === -1) return { form: "题库海", answer: data.msg || "" };
				return {
					form: "题库海",
					answer: body.answer || data.msg || "",
					num: body.num || "",
					usenum: body.usenum || ""
				};
			} catch (e) {
				return { form: "题库海", answer: "" };
			}
		}
		// 一之题库（该接口目前多数已下线，无 token 时直接跳过，避免无谓请求）
		async yizhi(question) {
			var token = getConfig().yztoken;
			if (!token) return { form: "一之题库", answer: "" };
			try {
				var res = await this.request(BANK.yizhi, "POST", { question: question.question }, {
					"Content-Type": "application/json",
					Authorization: token
				});
				var data = ServerApi.json(res);
				if (!data || data.code !== 1 || typeof data.data !== "string") return { form: "一之题库", answer: "" };
				var text = data.data.replace(/javascript:void\(0\);/g, "").trim().replace(/\n/g, "");
				var blocked = ["叛逆", "公众号", "李恒雅", "一之"].some((word) => text.indexOf(word) !== -1);
				return { form: "一之题库", answer: blocked ? "" : text.split("#") };
			} catch (e) {
				return { form: "一之题库", answer: "" };
			}
		}
		// 言溪题库
		async yanxi(question) {
			var token = getConfig().ennyctoken;
			if (!token) return { form: "言溪题库", answer: "" };
			try {
				var res = await this.request(BANK.yanxi, "POST", {
					token,
					title: question.question
				}, { "Content-Type": "application/json" });
				var data = ServerApi.json(res);
				if (!data || data.code !== 1) return { form: "言溪题库", answer: "" };
				return { form: "言溪题库", answer: data.data && data.data.answer || "" };
			} catch (e) {
				return { form: "言溪题库", answer: "" };
			}
		}
		// 木可题库
		async muketool(question) {
			try {
				var res = await this.request(BANK.muketool, "POST", {
					question: question.question,
					type: parseInt(question.type, 10) || 0
				}, { "Content-Type": "application/json" });
				var data = ServerApi.json(res);
				if (!data || data.code !== 1 || typeof data.data !== "string") return { form: "木可题库", answer: "" };
				return { form: "木可题库", answer: data.data.split("#") };
			} catch (e) {
				return { form: "木可题库", answer: "" };
			}
		}
	};
	var server = new ServerApi();
	async function getAnswers(question) {
		var results = await Promise.allSettled([
			server.tikuhai(question),
			server.yizhi(question),
			server.yanxi(question),
			server.muketool(question)
		]);
		return results.filter((item) => item.status === "fulfilled").map((item) => item.value).filter((item) => {
			if (!item || !item.answer) return false;
			return Array.isArray(item.answer) ? item.answer.length > 0 : String(item.answer).trim().length > 0;
		});
	}
	/* ============================================================
	 *  6. 站点适配层：所有 DOM 选择器集中在这里
	 *     海旗是 Vue + Element UI 的 SPA，同一站内不同页面结构差异较大，
	 *     因此选择器写成“候选列表 + 可见性过滤 + 结构启发式兜底”，
	 *     某个选择器失效时还有后续兜底，不会整段功能瘫痪。
	 * ============================================================ */
	var SITE = {
		video: [
			"#videoContent video",
			"video.video-player",
			".video-container video",
			"video.vjs-tech",
			".vjs-tech",
			".ckplayer video",
			"video",
			".prism-player video",
			".dplayer-video-wrap video",
			"#player-con video"
		],
		// 拓知真实目录：.detmain-navs > .detmain-navlist > .group.two > .list > .item > a
		// 大章节标题在 .group > .name > a，小节在 .group > .list > .item > a；
		// 折叠分组的 .list 是 display:none，但小节节点仍在 DOM 中，不能按可见性过滤。
		// 兜底列表只用于其它平台（海旗 .section-item 等）。
		chapter: [
			".detmain-navs .list .item a[href]",
			".course-chapters .section-item",
			".chapter-sections .section-item",
			".course-sidebar .section-item",
			".video-item",
			".chapter-item",
			"[class*='chapter'] li",
			"[class*='catalog'] li",
			"[class*='directory'] li"
		],
		chapterActive: ["active", "is-active", "current", "selected", "on"],
		nextButton: ["button", ".el-button", "a.btn", "[class*='next']"],
		dialog: [
			".el-dialog__wrapper",
			".el-message-box__wrapper",
			".el-overlay",
			".modal",
			".layui-layer"
		],
		question: [
			"[class*='subject-item']",
			"[class*='question-item']",
			"[class*='questionLi']",
			"[class*='timu']",
			"[class*='exam-question']",
			"[class*='topic-item']",
			"[class*='q-item']"
		],
		stem: [
			"[class*='question-title']",
			"[class*='subject-title']",
			"[class*='timu-title']",
			"[class*='stem']",
			"[class*='q-title']",
			".title"
		],
		option: [
			".option-item",
			".answer-item",
			".el-radio",
			".el-checkbox",
			"li"
		],
		textbox: [
			"textarea",
			".el-textarea__inner",
			"input[type='text']",
			"[contenteditable='true']"
		],
		submitText: /提交|交卷|保存并提交/,
		nextText: /下一题|下一步|下一页|继续|下一节|下一章/
	};

	/* ---------------- 6.1 基础 DOM 工具 ---------------- */
	function isVisible(el) {
		if (!el || !el.isConnected) return false;
		if (el.offsetParent !== null) return true;
		try {
			var view = el.ownerDocument.defaultView || pageWindow;
			var style = view.getComputedStyle(el);
			if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
			var rect = el.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) return true;
			return style.position === "fixed";
		} catch (e) {
			return false;
		}
	}
	function textOf(el) {
		return el && (el.innerText || el.textContent) || "";
	}
	function firstMatch(root, selectors, filter) {
		for (var i = 0; i < selectors.length; i++) {
			var list = root.querySelectorAll(selectors[i]);
			for (var j = 0; j < list.length; j++) {
				if (!filter || filter(list[j])) return list[j];
			}
		}
		return null;
	}
	function commonAncestor(nodes) {
		if (!nodes.length) return null;
		var node = nodes[0];
		while (node && node !== document.body) {
			if (nodes.every((n) => node.contains(n))) return node;
			node = node.parentElement;
		}
		return null;
	}
	function innermost(list) {
		return list.filter((el, index) => !list.some((other, otherIndex) => otherIndex !== index && el.contains(other)));
	}
	var nodeIdCache = new WeakMap();
	var nodeIdSeq = 0;
	function nodeKey(node) {
		if (!nodeIdCache.has(node)) nodeIdCache.set(node, ++nodeIdSeq);
		return nodeIdCache.get(node);
	}
	function clickEl(el) {
		if (!el) return;
		[
			"pointerdown",
			"mousedown",
			"pointerup",
			"mouseup",
			"click"
		].forEach((type) => {
			var event;
			try {
				event = new pageWindow.MouseEvent(type, {
					bubbles: true,
					cancelable: true,
					view: pageWindow
				});
			} catch (e) {
				event = new pageWindow.Event(type, {
					bubbles: true,
					cancelable: true
				});
			}
			el.dispatchEvent(event);
		});
	}
	function dispatch(el, type) {
		try {
			el.dispatchEvent(new pageWindow.Event(type, { bubbles: true }));
		} catch (e) {}
	}
	function setNativeValue(el, value) {
		var proto = el.tagName === "TEXTAREA" ? pageWindow.HTMLTextAreaElement.prototype : pageWindow.HTMLInputElement.prototype;
		var desc = Object.getOwnPropertyDescriptor(proto, "value");
		if (desc && desc.set) desc.set.call(el, value);
		else el.value = value;
		dispatch(el, "input");
		dispatch(el, "change");
	}
	function setNativeChecked(input, checked) {
		var desc = Object.getOwnPropertyDescriptor(pageWindow.HTMLInputElement.prototype, "checked");
		if (desc && desc.set) desc.set.call(input, checked);
		else input.checked = checked;
	}
	function findButtonByText(pattern, selectors) {
		var list = document.querySelectorAll(selectors.join(","));
		for (var i = 0; i < list.length; i++) {
			var el = list[i];
			if (el.disabled || !isVisible(el)) continue;
			if (pattern.test(textOf(el).trim())) return el;
		}
		return null;
	}

	/* ---------------- 6.2 视频 / 章节 ---------------- */
	var rateDesc = Object.getOwnPropertyDescriptor(pageWindow.HTMLMediaElement.prototype, "playbackRate");
	var ctDesc = Object.getOwnPropertyDescriptor(pageWindow.HTMLMediaElement.prototype, "currentTime");
	var antiRewind = {
		on: false,
		patched: false,
		blocked: 0
	};
	var toastObserver = null;
	var NOISE_RE = /不允许快进|播放速度不能超过|请勿快进/;
	function findVideo() {
		var found = firstMatch(document, SITE.video, (el) => el.tagName === "VIDEO" && isVisible(el));
		if (found) return found;
		// 少数页面把播放器放进同源 iframe（@noframes 下脚本不会在 iframe 内运行）
		var frames = document.querySelectorAll("iframe");
		for (var i = 0; i < frames.length; i++) {
			try {
				var doc = frames[i].contentDocument;
				if (!doc) continue;
				var inner = doc.querySelector("video");
				if (inner && isVisible(inner)) return inner;
			} catch (e) {}
		}
		return null;
	}
	function lockRate(video, rate) {
		if (!rateDesc || !rateDesc.set || !Number.isFinite(rate)) return;
		if (!video.__mfLocked) {
			try {
				Object.defineProperty(video, "playbackRate", {
					configurable: true,
					get() {
						return rateDesc.get.call(video);
					},
					set(value) {
						try {
							rateDesc.set.call(video, video.__mfRate || value);
						} catch (e) {
							rateDesc.set.call(video, value);
						}
					}
				});
				video.__mfLocked = true;
			} catch (e) {
				log("倍速锁定失败：" + e.message, "error");
				return;
			}
		}
		video.__mfRate = rate;
		try {
			rateDesc.set.call(video, rate);
		} catch (e) {}
	}
	// 关闭“强制倍速”时要把实例上的访问器删掉，否则平台/播放器自己改倍速会被劫持
	function unlockRate(video) {
		if (!video || !video.__mfLocked) return;
		try {
			delete video.playbackRate;
		} catch (e) {}
		video.__mfLocked = false;
		video.__mfRate = void 0;
	}
	function installAntiRewind() {
		if (antiRewind.patched || !ctDesc || !ctDesc.set) return;
		try {
			Object.defineProperty(pageWindow.HTMLMediaElement.prototype, "currentTime", {
				configurable: true,
				get() {
					return ctDesc.get.call(this);
				},
				set(value) {
					if (antiRewind.on && Number(value) < ctDesc.get.call(this) - .05) {
						antiRewind.blocked++;
						return;
					}
					ctDesc.set.call(this, value);
				}
			});
			antiRewind.patched = true;
			log("防回拽已就位", "success");
		} catch (e) {
			log("防回拽安装失败：" + e.message, "error");
		}
	}
	function dropNoiseToast(node) {
		if (!node || node.nodeType !== 1) return;
		var list = node.matches && node.matches(".el-message,.el-message-box") ? [node] : Array.prototype.slice.call(node.querySelectorAll(".el-message,.el-message-box"));
		list.forEach((el) => {
			if (NOISE_RE.test(textOf(el))) el.remove();
		});
	}
	function installToastMute() {
		if (toastObserver) return;
		document.querySelectorAll(".el-message,.el-message-box").forEach(dropNoiseToast);
		toastObserver = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((node) => {
					dropNoiseToast(node);
					setTimeout(() => {
						dropNoiseToast(node);
					}, 80);
				});
			});
		});
		toastObserver.observe(document.body, {
			childList: true,
			subtree: true
		});
	}
	function closeDialogs() {
		if (isStopped()) return;
		if (getConfig().autoCloseDialogs === false) return;
		// v3.4.7：删掉「继续 / 继续学习」——这类按钮会让站点按自己的进度记录跳转，
		// 落点完全不受课程目录控制，是「乱跳章节」的嫌疑之一。只点纯关闭词。
		var REG = /^(确定|确认|知道了|好的|关闭|我知道了)$/;
		SITE.dialog.forEach((selector) => {
			Array.prototype.slice.call(document.querySelectorAll(selector)).forEach((wrapper) => {
				if (!isVisible(wrapper)) return;
				// 验证码弹窗一律不碰：里面是本人输入验证码的入口
				if (isCaptchaLayer(wrapper)) {
					vlog("dialog", "检测到验证码弹窗，不代点任何按钮", { selector: selector });
					return;
				}
				var buttons = wrapper.querySelectorAll("button,.el-button,.btn-primary,[class*='btn']");
				for (var i = 0; i < buttons.length; i++) {
					var label = textOf(buttons[i]).trim();
					if (!REG.test(label)) continue;
					var href = (buttons[i].getAttribute && (buttons[i].getAttribute("href") || buttons[i].getAttribute("data-url") || "")) || "";
					var onclick = (buttons[i].getAttribute && buttons[i].getAttribute("onclick")) || "";
					if (/nodeId|goNode|\d{5,}/i.test(href + " " + onclick)) {
						vlog("block", "弹窗按钮带 nodeId，拒绝点击（防止跳到别的章节）", { label: label, href: href, onclick: onclick });
						continue;
					}
					vlog("dialog", "点击普通弹窗的纯关闭按钮", { label: label, selector: selector });
					clickEl(buttons[i]);
					return;
				}
				vlog("dialog", "弹窗里没有可安全点击的关闭按钮", { selector: selector, buttons: buttons.length });
			});
		});
	}
	/* ---------------- 6.2.1b 验证码：本人填写，助手只读旁观（v3.4.8） ----------------
	 * 站点原理（公开静态资源 /static/user/js/video.js，与实测截图一致）：
	 *   1) 每秒定时器只在 playState=='playing' 时 totalTime++；每 10 秒（支持
	 *      sendBeacon 时 30 秒）心跳 sendTime() 仅在 totalTime>studyTime 时发到
	 *      /user/node/study，服务端记录学时；
	 *   2) 服务端返回 status:false + need_code:1 时，先把闭包变量 playState='pause'
	 *      （不是靠 video.pause 回调！），再 player.videoPause()，然后
	 *      layer.open({type:1, btn:['开始播放','取消'], ...}) 弹验证码框；
	 *   3) 本人输入验证码点「开始播放」→ sendCode() 依赖 layIndex → layer.close →
	 *      sendTime(1, code) 交给服务端校验；只有 status:true 才 playState='playing'
	 *      + player.videoPlay()，学时从这一刻起才继续累计；
	 *   4) need_code:2 时不走 layer，而是把 <form class="bform"> 塞进 #video-captcha。
	 *
	 * 用户 v3.4.8 明确要求：验证码由本人填写，助手只管自动播放与切换视频。
	 * 因此本模块不再「接管」验证码，以下行为全部删除：
	 *   - 不 hook layer.open（它的返回值 layIndex 是站点提交验证码的凭证，v3.4.5
	 *     拦截它直接导致学时为 0）；
	 *   - 不关闭/隐藏弹窗、不碰 #video-captcha、不闪烁标签页标题、不代点按钮；
	 *   - 不吞 video.pause()、不主动 video.play()、不识别/代填验证码、
	 *     不伪造 code、不伪造学时心跳、不因页面文字停止脚本。
	 * 唯一保留的保护：弹窗还在时本轮暂停所有自动动作；弹窗消失后给 90 秒
	 * 观察宽限，期间「平台主动暂停」不算播放失败、不触发跳节。否则本人正在
	 * 填验证码的几十秒里，旧的 10 秒观察窗口会判播放失败并连切好几节——
	 * 这正是「乱跳章节」最直接的成因。
	 */
	/* ---------------- 6.2.1b-0 最详细运行日志（v3.4.7） ----------------
	 * 面板 task.log 只保留 20 条，且切小节是整页刷新会清空内存，
	 * 所以详细日志写进 sessionStorage 跨页累积，并提供控制台导出入口。
	 * 控制台全量打印；面板按 tag 节流，避免把关键日志冲掉。
	 */
	var LOG_KEY = "mf_tuozhi_runlog";
	var LOG_MAX = 800;
	var LOG_PANEL_THROTTLE_MS = 2500;
	var logState = { panelAt: Object.create(null) };
	function logVerboseEnabled() {
		try { return getConfig().verboseLog !== false; } catch (e) { return true; }
	}
	function readLogStore() {
		try {
			var raw = pageWindow.sessionStorage.getItem(LOG_KEY);
			var arr = raw ? JSON.parse(raw) : [];
			return Array.isArray(arr) ? arr : [];
		} catch (e) { return []; }
	}
	function writeLogStore(arr) {
		try { pageWindow.sessionStorage.setItem(LOG_KEY, JSON.stringify(arr.slice(-LOG_MAX))); } catch (e) {}
	}
	function vlog(tag, msg, data, level) {
		try {
			var verbose = logVerboseEnabled();
			var key = String(tag || "misc");
			// 即使关闭详细日志，关键事件（切换/拦截/错误/启动/跳过/验证码）也留痕
			var critical = /^(switch|block|error|boot|target|captcha|skip|guard|navigate)$/.test(key) || level === "error";
			if (!verbose && !critical) return null;
			var arr = readLogStore();
			var seq = (arr.length ? (Number(arr[arr.length - 1].seq) || 0) : 0) + 1;
			var now = Date.now();
			var entry = {
				seq: seq,
				t: new Date(now).toLocaleTimeString() + "." + String(now % 1000).padStart(3, "0"),
				ts: now,
				page: String(location.href || ""),
				tag: key,
				level: level || "info",
				msg: String(msg || ""),
				data: data === undefined ? null : data
			};
			arr.push(entry);
			if (arr.length > LOG_MAX) arr = arr.slice(-LOG_MAX);
			writeLogStore(arr);
			try { console.log("[MF " + key + " #" + seq + "] " + entry.msg, data === undefined ? "" : data); } catch (e) {}
			if (verbose && ui.ask && now - (logState.panelAt[key] || 0) > LOG_PANEL_THROTTLE_MS) {
				logState.panelAt[key] = now;
				try { ui.ask.log("[" + key + "] " + entry.msg, level || "info"); } catch (e) {}
			}
			return entry;
		} catch (e) { return null; }
	}
	function mfLogEntries(limit) {
		var arr = readLogStore();
		var n = Number(limit) > 0 ? Math.min(Number(limit), arr.length) : arr.length;
		return arr.slice(-n);
	}
	function mfLogText(limit) {
		return mfLogEntries(limit).map((e) => {
			var d = e.data ? (typeof e.data === "string" ? e.data : JSON.stringify(e.data)) : "";
			return "#" + e.seq + " [" + e.t + "] [" + e.tag + "/" + e.level + "] " + e.msg + (d ? " | " + d : "") + " | " + e.page;
		}).join("\n");
	}
	function mfLogClear() {
		try { pageWindow.sessionStorage.removeItem(LOG_KEY); } catch (e) {}
		logState.panelAt = Object.create(null);
		return true;
	}
	var captchaGuard = {
		lastSeenAt: 0,
		episodeStartAt: 0,
		seenTotal: 0,
		lastLogAt: 0,
		wasPresent: false
	};
	// 弹窗消失后的观察宽限：平台要等服务端校验通过才 player.videoPlay()，
	// 这段时间内视频仍是 paused，绝不能按「播放失败」把本节切走。
	var CAPTCHA_GRACE_MS = 90e3;
	// 只认站点 video.js 生成的 DOM 结构，绝不靠「页面里有『验证』两个字」扫描
	function isCaptchaLayer(box) {
		if (!box || !box.querySelector) return false;
		try {
			return !!box.querySelector('img[src*="/service/code"],#codeImg,#yzCode,input[placeholder*="验证码"],form.bform,.bform');
		} catch (e) { return false; }
	}
	// need_code=1：layer.open 弹出的「信息 / 开始播放 / 取消」框
	function captchaLayerVisible() {
		var layers = Array.prototype.slice.call(document.querySelectorAll(".layui-layer"));
		for (var i = 0; i < layers.length; i++) {
			if (ownUi(layers[i])) continue;
			if (isCaptchaLayer(layers[i]) && isVisible(layers[i])) return true;
		}
		return false;
	}
	// 只读检测「本人还没处理完的验证码」：layer 框 / need_code=2 的点选容器
	function detectCaptchaPresent() {
		if (captchaLayerVisible()) return true;
		try {
			var holder = document.querySelector("#video-captcha");
			if (holder && isVisible(holder) && String(holder.innerHTML || "").trim()) return true;
		} catch (e) {}
		return false;
	}
	function captchaPresent() {
		try {
			if (!detectCaptchaPresent()) return false;
			// need_code=1：本人点「开始播放」会 layer.close 移除 DOM，弹窗还在就一定没验证完
			if (captchaLayerVisible()) return true;
			// need_code=2：点选验证完成后站点不清空 #video-captcha（靠 html()!==''
			// 防重复渲染），光看 DOM 会永久卡住。平台校验通过一定会 player.videoPlay()，
			// 所以「视频已恢复播放」是可靠的完成信号；3 秒保护窗口避免弹窗刚出现、
			// 平台还没来得及暂停时误判。
			if (captchaGuard.episodeStartAt && Date.now() - captchaGuard.episodeStartAt > 3000) {
				var v = findVideo();
				if (v && !v.paused && !v.ended) {
					if (Date.now() - captchaGuard.lastLogAt > 15e3) {
						captchaGuard.lastLogAt = Date.now();
						vlog("captcha", "点选验证码容器仍在 DOM，但平台已恢复播放：视为验证完成，继续自动流程", { episodeSec: Math.round((Date.now() - captchaGuard.episodeStartAt) / 1000) });
					}
					return false;
				}
			}
			return true;
		} catch (e) { return false; }
	}
	function inCaptchaGrace() {
		return captchaGuard.lastSeenAt > 0 && Date.now() - captchaGuard.lastSeenAt < CAPTCHA_GRACE_MS;
	}
	// 只记时间与日志：绝不改 DOM、绝不改标题、绝不碰 layer / pause / play
	function noteCaptchaSeen() {
		var fresh = !inCaptchaGrace();
		captchaGuard.lastSeenAt = Date.now();
		if (fresh) {
			captchaGuard.seenTotal++;
			captchaGuard.episodeStartAt = Date.now();
		}
		if (!captchaGuard.episodeStartAt) captchaGuard.episodeStartAt = Date.now();
		if (Date.now() - captchaGuard.lastLogAt < 15e3) return;
		captchaGuard.lastLogAt = Date.now();
		vlog("captcha", "平台验证码弹窗出现：助手本轮不做任何动作，等待本人输入", { seenTotal: captchaGuard.seenTotal, url: location.href, graceSec: CAPTCHA_GRACE_MS / 1000 }, "error");
		if (ui.ask) {
			ui.ask.log("⏸ 平台要求本人验证：请在弹窗里输入验证码并点「开始播放」。助手不碰弹窗，验证通过后自动继续播放与切换", "error");
			ui.ask.msg("⏸ 等待本人输入验证码");
		}
	}
	function noteCaptchaCleared() {
		vlog("captcha", "验证码弹窗已消失：恢复自动流程（平台校验通过后自行恢复播放，助手不代点播放）", { seenTotal: captchaGuard.seenTotal }, "success");
		// 关键：刷新播放观察窗口，避免「平台还没恢复播放」被误判成失败而跳节
		runtime.playWatchSince = Date.now();
		runtime.playAttemptFailed = false;
		if (ui.ask) ui.ask.msg("▶ 验证完成，继续学习");
	}
	// 只读状态机：弹窗在 → 记时间；弹窗消失 → 记一次恢复。没有任何页面副作用。
	function updateCaptchaState() {
		var present = captchaPresent();
		if (present) noteCaptchaSeen();
		else if (captchaGuard.wasPresent && inCaptchaGrace()) noteCaptchaCleared();
		captchaGuard.wasPresent = present;
	}
	// 只读的「学时为什么没涨」自检：不修改页面、不伪造任何请求
	function studyHealth() {
		var tips = [];
		var present = captchaPresent();
		var hidden = typeof document.visibilityState === "string" && document.visibilityState !== "visible";
		var v = null;
		try { v = findVideo(); } catch (e) {}
		var multiPage = false;
		try {
			var ls = pageWindow.localStorage;
			var cur = currentNodeId();
			if (ls && cur && typeof ls.length === "number") {
				for (var i = 0; i < ls.length; i++) {
					var k = ls.key(i);
					if (k && k.indexOf("node_play_") === 0) {
						var val = ls.getItem(k);
						if (val && val !== cur) multiPage = true;
					}
				}
			}
		} catch (e) {}
		if (present) tips.push("平台正等待本人输入验证码，学时心跳已暂停；在弹窗输入并点「开始播放」后才会继续累计");
		if (inCaptchaGrace() && !present && v && v.paused) tips.push("验证码刚提交，平台还在等服务端校验；校验通过后平台会自己恢复播放，助手不会代点播放按钮");
		if (hidden) tips.push("页面不在前台，Chrome 会节流 1 秒计时器，学时增长明显变慢甚至停滞；请保持标签页可见");
		if (multiPage) tips.push("检测到别的视频页面同时在播放，平台会暂停学时；请只保留一个视频标签页");
		if (!v) tips.push("本页没有视频元素（课后作业/测验节），本节本身不产生视频学时");
		else if (v.paused && !present && !inCaptchaGrace()) tips.push("视频当前暂停，平台只在播放状态下累计学时");
		if (!tips.length) tips.push("未发现阻断：验证码已通过、视频在播、页面在前台时，学时应由平台心跳正常累计");
		return {
			mode: "observer（本人填写，助手只读旁观）",
			visibility: document.visibilityState || "unknown",
			popupPresent: present,
			inGrace: inCaptchaGrace(),
			seenTotal: captchaGuard.seenTotal,
			video: v ? { paused: !!v.paused, ended: !!v.ended, currentTime: Math.round(v.currentTime || 0), rate: v.playbackRate } : null,
			tips: tips
		};
	}
	function captchaMode() { return "observer"; }
	// boot 里保留这个调用点，但它现在不安装任何钩子：验证码完全由本人处理
	function installCaptchaGuard() {
		vlog("captcha", "验证码由本人填写：助手只读旁观，不 hook layer.open、不关弹窗、不吞暂停、不代填", { mode: captchaMode() });
	}
	/* ---------------- 6.2.1c 防乱跳：单标签页切换锁 + 导航落点校验（v3.4.8） ----------------
	 * 多开课程视频页时，每个页面都按自己的目录切节，浏览器里看到的就是「乱跳」；
	 * 平台还会因为多开而暂停学时。用 localStorage 租约保证只有一个页面能发起切换。
	 * 所有存储异常一律「放行」，绝不因为锁把脚本卡死。
	 */
	var LEASE_KEY = "mf_tuozhi_switch_owner";
	var TAB_KEY = "mf_tuozhi_tab_id";
	var LEASE_TTL_MS = 15e3;
	function switchLockEnabled() {
		try { return getConfig().singleTabLock !== false; } catch (e) { return true; }
	}
	function tabIdentity() {
		try {
			var id = pageWindow.sessionStorage.getItem(TAB_KEY);
			if (!id) {
				id = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
				pageWindow.sessionStorage.setItem(TAB_KEY, id);
			}
			return id;
		} catch (e) { return "local"; }
	}
	function readLease() {
		try {
			var raw = pageWindow.localStorage.getItem(LEASE_KEY);
			if (!raw) return null;
			var o = JSON.parse(raw);
			return o && o.id ? o : null;
		} catch (e) { return null; }
	}
	function writeLease(id) {
		try {
			pageWindow.localStorage.setItem(LEASE_KEY, JSON.stringify({ id: id, at: Date.now(), url: location.href, visible: document.visibilityState !== "hidden" }));
		} catch (e) {}
	}
	function leaseAlive(lease) {
		return !!lease && Date.now() - (Number(lease.at) || 0) < LEASE_TTL_MS;
	}
	// 每轮循环续约：后台标签页不续约，把切换权让给前台可见页面
	function renewSwitchLease() {
		if (!switchLockEnabled()) return { disabled: true };
		var id = tabIdentity();
		if (document.visibilityState === "hidden") {
			var cur = readLease();
			return { owner: cur ? cur.id : "", self: false, hidden: true };
		}
		var lease = readLease();
		if (!lease || !leaseAlive(lease) || lease.id === id) {
			writeLease(id);
			return { owner: id, self: true };
		}
		return { owner: lease.id, self: false };
	}
	function canSwitchNow() {
		if (!switchLockEnabled()) return { ok: true, why: "开关关闭" };
		var id = tabIdentity();
		var lease = readLease();
		if (!lease || !leaseAlive(lease) || lease.id === id) {
			writeLease(id);
			return { ok: true, why: lease ? (leaseAlive(lease) ? "本页持锁" : "租约过期已接管") : "无持锁页" };
		}
		// 前台页面可以接管后台持锁页，避免「后台页占着锁、前台页不动」
		if (document.visibilityState !== "hidden" && lease.visible === false && Date.now() - (Number(lease.at) || 0) > 3e3) {
			writeLease(id);
			return { ok: true, why: "前台页面接管（原持锁页在后台）" };
		}
		return { ok: false, why: "另一个课程标签页正在自动切换", owner: lease.id, ageSec: Math.round((Date.now() - (Number(lease.at) || 0)) / 1000) };
	}
	function releaseSwitchLease() {
		try {
			var lease = readLease();
			if (lease && lease.id === tabIdentity()) pageWindow.localStorage.removeItem(LEASE_KEY);
		} catch (e) {}
	}
	// 导航落点校验：站点若把跳转重定向到别的章节，落点与刚写入的 target 会相差多节。
	// 这时清掉陈旧目标，让 locateCurrent 按真实 URL nodeId 定位（用户手动跳章也正确），
	// 并写一条显眼日志；不硬停脚本，避免误伤正常的手动跳章。
	function checkNavigationLanding() {
		if (!targetValid()) return { ok: true, why: "没有刚发起的切换目标" };
		var target = lastTargetId();
		var urlId = currentNodeId();
		if (!urlId || urlId === target) return { ok: true, why: "落点与目标一致", target: target, urlId: urlId };
		var items = catalog();
		var ti = items.findIndex((e) => e.nodeId === target);
		var ui = items.findIndex((e) => e.nodeId === urlId);
		if (ti < 0 || ui < 0) return { ok: true, why: "作业/测验页 URL nodeId 不在目录里，按目标定位", target: target, urlId: urlId };
		var gap = Math.abs(ui - ti);
		if (gap > 1) {
			clearStaleTarget();
			vlog("block", "★ 导航落点异常：目标第 " + (ti + 1) + " 节（" + target + "），实际落在第 " + (ui + 1) + " 节（" + urlId + "）。已清除陈旧目标，改按真实 URL 定位，不会按错位置继续切", { target: target, urlId: urlId, gap: gap, url: location.href }, "error");
			return { ok: true, adjusted: true, why: "落点与目标相差 " + gap + " 节，已改按真实 URL 定位", target: target, urlId: urlId, gap: gap };
		}
		return { ok: true, why: "落点与目标相邻", target: target, urlId: urlId, gap: gap };
	}

	/* ---------------- 6.2.1 拓知课程目录：大章节(.group) / 小节(.list .item) ----------------
	 * 站点真实结构（/static/school/huatang/user/css/style.css）：
	 *   .detmain-navs > .detmain-navlist > .group.two[.on] > .name > a      大章节（折叠标题）
	 *                                      > .list > .item > a[.on]        小节（真正要播放的节点）
	 * 旧版本三个致命问题：
	 *   1) 用 href*='/user/node' 字面量匹配，相对链接 "?nodeId=xxx" 全部漏掉；
	 *   2) 折叠分组 display:none，按可见性过滤后只剩当前大章节下的 1 个小节；
	 *   3) 切小节是整页刷新，脚本状态清空，靠 .active 定位会回跳/连点。
	 * 现在统一：读 a.href（浏览器解析后的绝对地址）里的 nodeId，收录隐藏小节，
	 * 用 URL / #video-nodeId 定位当前小节，按课程顺序取下一节，必要时直接导航。
	 */
	/* ---------------- 6.2.1a 失败跳过：不重试、不熔断 ----------------
	 * v3.4.0：本节没有视频或点击播放失败，直接切到下一小节。
	 *   - 同一个视频只点击一次播放（按 videoKey 记忆），绝不重复点击；
	 *   - 不再因为页面文字 / 验证码组件 / 播放器文案而停止脚本；
	 *   - 停止能力仅保留给用户手动调用（__mfStop() / 浮层按钮 / __mfResume()）。
	 * 切小节是整页刷新，手动停止状态写进 sessionStorage，下一页保持停止。
	 */
	var STOP_KEY = "mf_tuozhi_emergency_stop";
	var PLAY_WATCH_MS = 10 * 1000;   // 点击后最多观察 10 秒是否真正起播，期间绝不再点
	var safety = {
		stopped: false,
		reason: "",
		detail: "",
		at: 0,
		graceUntil: 0,
		skipCount: 0                 // 仅用于日志统计连续跳过的小节数，不触发停止
	};
	// 以下常量仅供「停止时写明原因」用，绝不作为停止条件，避免误判误停
	var CAPTCHA_SELECTORS = [
		"#tcaptcha", ".tcaptcha", "#captcha", ".captcha",
		"[id*='captcha']", "[class*='captcha']",
		"[id*='geetest']", "[class*='geetest']",
		"[class*='nc_wrapper']", "[class*='nc-container']", "[class*='slide-verify']",
		"[class*='slider-verify']", "[class*='verify-wrap']", "[class*='verify-box']",
		"img[src*='captcha']", "img[src*='kaptcha']", "img[src*='verifycode']", "img[src*='vcode']",
		"input[name*='captcha']", "input[name*='verifycode']", "input[placeholder*='验证码']",
		"iframe[src*='captcha']", "iframe[src*='verify']", "iframe[src*='turing']", "iframe[src*='geetest']"
	];
	var CAPTCHA_STRONG = /安全验证|人机验证|请完成验证|请完成安全校验|拖动滑块|按住滑块|向右滑动|点击图中|依次点击|图形验证码|请输入验证码|输入验证码|获取验证码|短信验证码|行为验证|验证失败|验证超时|滑动验证|滑块验证|captcha|slide to verify|verify you are human/i;
	var PLAY_ERROR_TEXT = /播放失败|加载视频失败|视频加载失败|无法播放|播放出错|播放异常|视频地址(错误|无效|不存在)|获取视频(失败|错误)|视频(不存在|已下架|已删除)|视频文件不存在|资源不存在|播放超时|视频超时|错误码[:：]?\s*\d{3,}|video error|playback error|request failed/i;
	var OWN_UI = "#manfen-task-root,#manfen-settings-root,#mf-safety-banner";
	function ownUi(el) {
		try { return !!(el && el.closest && el.closest(OWN_UI)); } catch (e) { return false; }
	}
	function readStopRecord() {
		try {
			var raw = pageWindow.sessionStorage.getItem(STOP_KEY);
			if (!raw) return null;
			var data = JSON.parse(raw);
			return data && data.reason ? data : null;
		} catch (e) { return null; }
	}
	function isStopped() {
		return safety.stopped;
	}
	// 手动恢复后给 15 秒宽限，避免刚恢复就又触发一次状态判断
	function inGrace() {
		return Date.now() < safety.graceUntil;
	}
	function captchaSignal() {
		var i, j, nodes, node;
		for (i = 0; i < CAPTCHA_SELECTORS.length; i++) {
			try { nodes = document.querySelectorAll(CAPTCHA_SELECTORS[i]); } catch (e) { continue; }
			for (j = 0; j < nodes.length; j++) {
				node = nodes[j];
				if (ownUi(node) || !isVisible(node)) continue;
				return "页面出现验证组件：" + CAPTCHA_SELECTORS[i];
			}
		}
		var layers = document.querySelectorAll(".el-dialog__wrapper,.el-message-box__wrapper,.el-overlay,.modal,.layui-layer,[role='dialog'],[class*='popup'],[class*='modal'],[class*='dialog']");
		for (i = 0; i < layers.length; i++) {
			node = layers[i];
			if (ownUi(node) || !isVisible(node)) continue;
			var t = textOf(node).trim().slice(0, 240);
			if (t && /验证码|验证|滑块|captcha|verify/i.test(t)) return "验证弹窗提示：" + t.slice(0, 60);
		}
		// 排除 <script>/<style> 里的 SDK 代码文本，否则站点引入验证组件就会误判
		var clone = document.body.cloneNode(true);
		var junk = clone.querySelectorAll("script,style,noscript,template,#mf-safety-banner,#manfen-task-root,#manfen-settings-root");
		for (i = 0; i < junk.length; i++) {
			if (junk[i].remove) junk[i].remove();
		}
		var bodyText = textOf(clone).slice(0, 8e3);
		var m = CAPTCHA_STRONG.exec(bodyText);
		if (m) return "页面出现验证提示：" + m[0];
		return "";
	}
	function playbackFailure() {
		var video = findVideo();
		if (video) {
			if (video.error) return "MediaError code=" + video.error.code + " " + (video.error.message || "");
			var src = video.currentSrc || video.src || "";
			if (src && video.networkState === 3) return "视频无可用资源（NETWORK_NO_SOURCE）";
		}
		var holders = document.querySelectorAll("#videoContent,.ckplayer,[class*='video-player'],[class*='player'],[class*='toast'],[class*='error'],[class*='tips'],.layui-layer,.el-message,.el-dialog");
		for (var i = 0; i < holders.length; i++) {
			var node = holders[i];
			if (ownUi(node) || !isVisible(node)) continue;
			var t = textOf(node).trim().slice(0, 200);
			if (t && PLAY_ERROR_TEXT.test(t)) return "播放器错误提示：" + t.slice(0, 60);
		}
		return "";
	}
	function showStopBanner() {
		if (document.getElementById("mf-safety-banner")) return;
		var box = document.createElement("div");
		box.id = "mf-safety-banner";
		box.setAttribute("data-mf-safety", "1");
		box.style.cssText = "position:fixed!important;right:24px!important;top:24px!important;z-index:2147483647!important;max-width:340px!important;box-sizing:border-box!important;background:#fff!important;color:#1f2329!important;border:2px solid #e34d59!important;border-radius:10px!important;box-shadow:0 10px 32px rgba(0,0,0,.24)!important;padding:16px 18px!important;font:14px/1.6 -apple-system,BlinkMacSystemFont,'PingFang SC',Arial,sans-serif!important;";
		var title = document.createElement("div");
		title.textContent = "⛔ 助手已停止";
		title.style.cssText = "font-size:16px!important;font-weight:700!important;color:#c9353f!important;margin-bottom:8px!important;";
		var desc = document.createElement("div");
		desc.textContent = "助手已手动停止，自动播放与自动切换均已暂停，不会再跳节。确认后可继续运行。";
		var btn = document.createElement("button");
		btn.textContent = "继续运行";
		btn.style.cssText = "margin-top:12px!important;width:100%!important;padding:8px 12px!important;border:0!important;border-radius:6px!important;background:#c9353f!important;color:#fff!important;font-size:14px!important;cursor:pointer!important;";
		btn.addEventListener("click", resumeScript);
		box.append(title, desc, btn);
		(document.body || document.documentElement).appendChild(box);
	}
	function stopScript(reason, detail) {
		if (safety.stopped) return;
		safety.stopped = true;
		safety.reason = reason;
		safety.detail = detail || "";
		safety.at = Date.now();
		safety.graceUntil = 0;
		try {
			pageWindow.sessionStorage.setItem(STOP_KEY, JSON.stringify({
				reason: reason,
				detail: detail || "",
				at: safety.at,
				url: location.href
			}));
		} catch (e) {}
		if (runtime.timer) {
			try { clearTimeout(runtime.timer); } catch (e) {}
			runtime.timer = null;
		}
		var video = findVideo();
		if (video) {
			try { video.pause(); } catch (e) {}
			try { unlockRate(video); } catch (e) {}
			try { video.playbackRate = 1; } catch (e) {}
		}
		antiRewind.on = false;
		// 别再吞掉站点的消息提示，否则用户看不到播放失败/验证的具体原因
		try {
			if (typeof toastObserver !== "undefined" && toastObserver) {
				toastObserver.disconnect();
				toastObserver = null;
			}
		} catch (e) {}
		if (ui.ask) {
			try { ui.ask.task.name = "已停止"; } catch (e) {}
			ui.ask.msg("⛔ 已停止：" + reason);
			ui.ask.log("【停止】" + reason + "：" + (detail || ""), "error");
			ui.ask.log("已停止自动播放/自动切换/自动答题。处理完页面提示后点浮层按钮，或控制台执行 __mfResume()", "error");
		}
		showStopBanner();
	}
	function resumeScript() {
		try { pageWindow.sessionStorage.removeItem(STOP_KEY); } catch (e) {}
		safety.stopped = false;
		safety.reason = "";
		safety.detail = "";
		safety.skipCount = 0;
		safety.graceUntil = Date.now() + 15e3;
		var banner = document.getElementById("mf-safety-banner");
		if (banner && banner.remove) banner.remove();
		if (ui.ask) {
			try { ui.ask.task.name = "等待任务"; } catch (e) {}
			ui.ask.msg("已恢复运行");
			ui.ask.log("用户确认后恢复运行", "success");
		}
		if (!runtime.timer) loop();
	}
	function safetyCheck() {
		// 只判断「用户手动停止」状态；页面文字、验证码组件、播放器文案一律不触发停止
		return isStopped();
	}
	// 把当前小节标记为不可用：之后每一轮都只会尝试切到下一小节，绝不再碰这个视频
	function skipCurrentSection(reason, detail) {
		if (runtime.skipReason) return;
		runtime.skipReason = reason;
		safety.skipCount += 1;
		vlog("skip", "标记本节不可用：「" + reason + "」（第 " + safety.skipCount + " 次），之后只切紧邻一节、绝不再点播放", { reason: reason, detail: detail || "", url: location.href, dwellSec: Math.round((Date.now() - runtime.pageEnterAt) / 1000) }, "error");
		var diag = diagnoseStop();
		if (ui.ask) {
			ui.ask.msg("本节" + reason + "，准备切到下一小节");
			ui.ask.log("【跳过本节 " + safety.skipCount + "】" + reason + (detail ? "：" + detail : "") + (diag ? "；页面线索：" + diag : "") + "。不再重复点击播放，直接切下一小节", "error");
		}
	}
	function isPlaybackRunning(video) {
		if (!video || video.ended || video.paused) return false;
		return video.readyState >= 2 || video.currentTime > 0;
	}
	function findPlayButton() {
		// CKPlayer / video.js / 阿里云播放器常见的大播放按钮
		var selectors = [
			".vjs-big-play-button", ".ckplayer-play", ".prism-play-btn",
			"[class*='big-play']", "[class*='play-btn']", "[class*='play-button']",
			"button[aria-label='播放']", "[title='播放']", "[aria-label='播放']"
		];
		for (var i = 0; i < selectors.length; i++) {
			try {
				var nodes = document.querySelectorAll(selectors[i]);
				for (var j = 0; j < nodes.length; j++) {
					if (isVisible(nodes[j]) && !ownUi(nodes[j])) return nodes[j];
				}
			} catch (e) {}
		}
		return null;
	}
	function diagnoseStop() {
		// 只把页面上的线索写进日志，绝不作为跳过/停止的触发条件
		var captcha = captchaSignal();
		var failure = playbackFailure();
		return [captcha, failure].filter(Boolean).join("；");
	}
	/* 返回 "playing" | "pending" | "failed" | "blocked" | "off"。
	 * 关键：按 videoKey 记忆「本节已点过播放」，同一个视频永远只点击一次，
	 * 后续轮次只观察播放状态，绝不重复点击；失败直接交给上层切下一小节。 */
	async function ensurePlaying(video, config, ask, videoKey) {
		if (isStopped()) return "off";
		if (!config.autoVideo || video.ended) return "off";
		if (isPlaybackRunning(video)) {
			if (runtime.playAttemptKey === videoKey && runtime.playAttemptFailed) {
				ask.log("视频已开始播放", "success");
				runtime.playAttemptFailed = false;
			}
			return "playing";
		}
		if (runtime.playAttemptKey === videoKey) {
			if (runtime.playAttemptFailed) return "failed";
			if (runtime.playAttemptBlocked) return "blocked";
			// 点击过但还没起播：只观察，不再点第二次
			if (Date.now() - runtime.playWatchSince < PLAY_WATCH_MS) return "pending";
			// v3.4.8：验证码刚由本人提交、平台还在等服务端校验，视频保持暂停是
			// 正常流程。90 秒宽限内只观察，绝不判失败、绝不跳节、绝不重复点播放。
			if (inCaptchaGrace()) {
				runtime.playWatchSince = Date.now();
				return "pending";
			}
			runtime.playAttemptFailed = true;
			ask.log("点击播放后 " + Math.round(PLAY_WATCH_MS / 1000) + " 秒仍未起播，判定本节播放失败", "error");
			return "failed";
		}
		// 本节第一次、也是唯一一次点击播放
		runtime.playAttemptKey = videoKey;
		runtime.playAttemptFailed = false;
		runtime.playAttemptBlocked = false;
		runtime.playWatchSince = Date.now();
		var btn = findPlayButton();
		if (btn) clickEl(btn);
		try {
			await video.play();
		} catch (e) {
			var name = e && e.name ? e.name : "Error";
			if (name === "NotAllowedError") {
				// 浏览器自动播放策略拦截：不重复点击、也不跳过本节，等用户手动点一下页面
				runtime.playAttemptBlocked = true;
				ask.log("浏览器拦截了自动播放（NotAllowedError），本视频不再重复点击，请手动点击页面一次", "error");
				return "blocked";
			}
			runtime.playAttemptFailed = true;
			ask.log("play() 播放失败：" + name + (e && e.message ? " " + e.message : ""), "error");
			return "failed";
		}
		if (isPlaybackRunning(video)) {
			ask.log("点击播放成功", "success");
			return "playing";
		}
		return "pending";
	}
	function installResumeCommand() {
		try {
			pageWindow.__mfResume = resumeScript;
			pageWindow.__mfStop = () => stopScript("手动停止", "控制台调用 __mfStop()");
		} catch (e) {}
	}
	var NODE_ID_RE = /(?:nodeId|node_id|nodeid)=(\d+)|\/user\/node\/(\d+)|\/node\/(\d+)/i;
	var JUMP_KEY = "mf_tuozhi_last_jump";
	// 上次切换的目标小节：作业/测验页的 URL nodeId 常与目录里的 nodeId 不一致，
	// 用它定位当前节，避免「找不到当前节就按 nodeId 猜位置」导致跨大章节乱跳。
	var TARGET_KEY = "mf_tuozhi_last_target";
	var TARGET_AT_KEY = "mf_tuozhi_last_target_at";
	// 目标只在「本脚本刚刚切换过来」的短时间内有效。v3.4.3 曾无条件信任这个
	// sessionStorage 值，用户隔了很久回到第二章课后作业时，残留的旧目标会把
	// 当前位置锚到第七章，于是一次就跳到第七章课后作业。
	// v3.4.7：从 120 秒收紧到 25 秒。切页通常几秒内完成；窗口太长时用户手动
	// 回到某章作业页（URL nodeId 不在目录里），会被几章之前的旧目标锚过去继续切。
	var TARGET_MAX_AGE_MS = 25e3;
	function nodeIdOf(value) {
		var m = NODE_ID_RE.exec(String(value || ""));
		return m ? (m[1] || m[2] || m[3] || "") : "";
	}
	function catalogRoot() {
		var selectors = [".detmain-navs", ".detmain-navlist", ".course-chapters", ".course-sidebar", "[class*='catalog']", "[class*='directory']"];
		for (var i = 0; i < selectors.length; i++) {
			var root = document.querySelector(selectors[i]);
			if (root && root.querySelector("a")) return root;
		}
		return document;
	}
	function catalogGroups(root) {
		var groups = Array.prototype.slice.call(root.querySelectorAll(".group"));
		return groups.filter((g) => !!g.querySelector(".list") || !!g.querySelector(".item"));
	}
	function currentNodeId() {
		var id = nodeIdOf(location.search) || nodeIdOf(location.hash);
		if (!id) {
			try { id = nodeIdOf(pageWindow.location.search) || nodeIdOf(pageWindow.location.href); } catch (e) {}
		}
		if (id) return id;
		var inputs = document.querySelectorAll("#video-nodeId, input[name='nodeId'], input[name='nodeid'], [data-node-id]");
		for (var i = 0; i < inputs.length; i++) {
			var raw = (inputs[i].value || inputs[i].getAttribute("data-node-id") || "").trim();
			if (/^\d+$/.test(raw)) return raw;
		}
		return "";
	}
	function isToggleLink(el) {
		var href = el && el.getAttribute ? (el.getAttribute("href") || "").trim() : "";
		return !href || href === "#" || /^(javascript:|void\()/i.test(href);
	}
	// 有些模板的小节不是链接，而是 onclick="goNode(1430464)" / data-url="?nodeId=..."
	function nodeIdFromAttributes(el) {
		var attrs = ["onclick", "data-url", "data-href", "data-node", "data-nodeid", "data-id", "data-node-id"];
		for (var i = 0; i < attrs.length; i++) {
			var raw = el.getAttribute(attrs[i]) || "";
			var id = nodeIdOf(raw);
			if (id) return id;
			var m = /\(\s*['"]?(\d{5,})['"]?\s*\)/.exec(raw) || /['"](\d{5,})['"]/.exec(raw);
			if (m) return m[1];
		}
		return "";
	}
	function isLockedEntry(el, item) {
		var cls = "";
		[el, item].forEach((n) => {
			if (n && typeof n.className === "string") cls += " " + n.className;
		});
		var tokens = cls.toLowerCase().split(/[\s_]+/);
		if (tokens.some((t) => /^(locked|lock|disabled|unopen|forbidden)$/.test(t))) return true;
		if (el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled")) return true;
		if (item && item.querySelector(".lock-icon,.unlock-time,.icon-lock,[class~='locked']")) return true;
		return /未解锁|未开放|暂未开放|锁定|不可学习/.test(textOf(item || el));
	}
	function makeEntry(el, group, order, groupIndex) {
		if (!el || !el.isConnected) return null;
		var href = "";
		try { href = el.href || ""; } catch (e) {}
		var rawHref = el.getAttribute("href") || el.getAttribute("data-href") || "";
		var dataId = (el.getAttribute("data-node-id") || el.getAttribute("data-nodeid") || el.getAttribute("data-id") || "").trim();
		var nodeId = nodeIdOf(href) || nodeIdOf(rawHref) || nodeIdFromAttributes(el);
		if (!nodeId && /^\d{4,}$/.test(dataId)) nodeId = dataId;
		if (!nodeId) return null;
		if (!/^https?:/i.test(href)) href = location.origin + "/user/node?nodeId=" + nodeId;
		var item = el.closest ? (el.closest(".item, li") || el) : el;
		var groupTitle = "";
		var nameEl = group && group.querySelector(".name");
		if (nameEl) groupTitle = textOf(nameEl).trim().replace(/\s+/g, " ").slice(0, 30);
		return {
			el: el,
			item: item,
			href: href,
			nodeId: nodeId,
			order: order,
			text: textOf(item).trim().replace(/\s+/g, " ").slice(0, 50),
			group: group,
			// 所属大章节序号：用于「同大章节内切换」，跨章节时按配置拦截
			groupIndex: typeof groupIndex === "number" ? groupIndex : -1,
			groupTitle: groupTitle,
			visible: isVisible(el),
			toggle: isToggleLink(el),
			locked: isLockedEntry(el, item)
		};
	}
	function catalog() {
		var root = catalogRoot();
		var groups = catalogGroups(root);
		// 检测到拓知两级目录时启用严格模式：只认 .list/.item 里的小节链接，
		// 绝不把 .group > .name > a 这种「大章节标题」当成可切换的小节。
		var strict = groups.length > 0;
		var seen = Object.create(null);
		var list = [];
		var order = 0;
		function add(el, group, groupIndex) {
			if (strict && isGroupHeaderLink(el)) return;
			var entry = makeEntry(el, group, order++, groupIndex);
			if (entry && !seen[entry.nodeId]) {
				seen[entry.nodeId] = 1;
				list.push(entry);
			}
		}
		// 1) 主路径：每个大章节 .list .item 里的小节（含折叠隐藏的）
		groups.forEach((group, gi) => {
			Array.prototype.slice.call(group.querySelectorAll(".list .item")).forEach((item) => {
				add(item.matches("a") ? item : (item.querySelector("a") || item), group, gi);
			});
		});
		// 2) 结构改名兜底：仅在主路径一条小节都没收到时才启用。
		// v3.4.3 无条件做这次全量扫描，页面上其它模块的 .list/.item（课件、作业列表等）
		// 会混进课程目录，把「紧邻的一节」挤到别的章节去。
		if (!list.length) {
			Array.prototype.slice.call(root.querySelectorAll(".list a[href], .item a[href]")).forEach((a) => {
				var g = a.closest ? a.closest(".group") : null;
				add(a, g, groups.indexOf(g));
			});
		}
		// 3) 兜底：严格模式一条小节都没收到时，也用小章节专用选择器再扫一遍
		//（只找 .list .item 里的链接，仍不会把大章节标题收进来），
		// 避免站点改了 .group 结构后「0 识别 → 整页不动」。
		if (!list.length) {
			for (var i = 0; i < SITE.chapter.length; i++) {
				Array.prototype.slice.call(document.querySelectorAll(SITE.chapter[i])).forEach((el) => {
					add(el.matches("a") ? el : (el.querySelector("a[href]") || el), null, -1);
				});
				if (list.length) break;
			}
		}
		return list;
	}
	// v3.4.7：目录还在异步渲染时，items 可能只有前几章，items[index+1] 会落到很远的
	// 章节。只有「连续若干轮指纹一致」才认为目录稳定，才允许发起切换。
	function catalogFingerprint(items) {
		return items.map((e) => e.groupIndex + ":" + e.nodeId).join("|");
	}
	function catalogStable(items) {
		var fp = catalogFingerprint(items);
		if (!fp) return false;
		if (fp !== runtime.catalogFp) {
			var prev = runtime.catalogFp;
			runtime.catalogFp = fp;
			runtime.catalogFpSince = Date.now();
			if (!runtime.catalogUnstableSince) runtime.catalogUnstableSince = Date.now();
			vlog("catalog", "课程目录指纹变化（子节点可能仍在渲染）：" + items.length + " 节，需稳定 " + (CATALOG_STABLE_MS / 1000) + " 秒才允许切换", {
				previous: prev ? prev.slice(0, 120) : "(首次读取)",
				current: fp.slice(0, 180),
				total: items.length,
				first3: items.slice(0, 3).map((e) => ({ nodeId: e.nodeId, group: e.groupTitle, text: e.text })),
				last3: items.slice(-3).map((e) => ({ nodeId: e.nodeId, group: e.groupTitle, text: e.text }))
			});
			return false;
		}
		var stableMs = Date.now() - runtime.catalogFpSince;
		if (stableMs >= CATALOG_STABLE_MS) {
			runtime.catalogUnstableSince = 0;
			return true;
		}
		// 兜底：站点若每隔几秒重绘目录导致指纹一直变，也不能永远不切换。
		// 仍严格要求「本轮指纹与上一轮完全一致」，只是放宽等待时长。
		if (runtime.catalogUnstableSince && Date.now() - runtime.catalogUnstableSince > 30e3) {
			vlog("catalog", "目录指纹持续变化超过 30 秒，但本轮与上一轮完全一致：按当前目录放行一次", { total: items.length, stableMs: stableMs });
			runtime.catalogUnstableSince = 0;
			return true;
		}
		return false;
	}
	function catalogSummary() {
		var root = catalogRoot();
		var groups = catalogGroups(root);
		return {
			groups: groups.length,
			// 没有 .list/.item 的纯大章节（点进去是章节首页）会被忽略，单独报出来便于核对
			bareGroups: Math.max(0, root.querySelectorAll(".group").length - groups.length),
			leaves: catalog().length,
			current: currentNodeId(),
			strict: groups.length > 0
		};
	}
	function isActiveItem(el) {
		if (!el || !el.classList) return false;
		if (SITE.chapterActive.some((name) => el.classList.contains(name))) return true;
		if (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current") === "true") return true;
		return SITE.chapterActive.some((name) => !!el.querySelector("." + name));
	}
	// 当前节高亮不一定在 <a> 上：站点可能把 .on/.cur 加在 .item、内部 span，
	// 或用 aria-current/data-current。只在「小节容器」范围内找，
	// 绝不把大章节 .group.on（展开态）误当成当前节。
	// focus / hover 是临时状态，不能拿来判断「当前在学哪一节」
	var CURRENT_CLASS_RE = /(?:^|[\s_-])(on|active|is-active|current|selected|cur|now|this|checked)(?:$|[\s_-])/i;
	function isCurrentEntry(e) {
		var nodes = [e.el, e.item];
		var holder = e.item || e.el;
		if (holder && holder.children) {
			for (var i = 0; i < holder.children.length && i < 5; i++) nodes.push(holder.children[i]);
		}
		for (var j = 0; j < nodes.length; j++) {
			var n = nodes[j];
			if (!n) continue;
			if (isActiveItem(n)) return true;
			if (typeof n.className === "string" && CURRENT_CLASS_RE.test(n.className)) return true;
			if (n.getAttribute && (n.getAttribute("data-current") === "true" || n.getAttribute("data-active") === "true")) return true;
		}
		return false;
	}
	// 作业/测验页的 URL nodeId 常与目录小节对不上，但页面标题就是小节名
	//（例如「作业标题：第二章课后作业」）。用它做一次文本定位，比按数值猜可靠得多。
	// 严格规则：只接受「规范化后完全相同」或「唯一命中」的包含匹配。
	// v3.4.3 的模糊匹配会因为目录里多章都叫「课后作业」而命中别的章节。
	function normalizeSectionLabel(s) {
		return String(s || "").replace(/\s+/g, "").replace(/[·:：,，.。\-—_()（）\[\]【】]/g, "").toLowerCase();
	}
	function matchByPageTitle(items) {
		var sels = ["h1", "h2", "h3", "[class*='work-title']", "[class*='homework-title']", "[class*='node-title']", "[class*='detmain-title']"];
		for (var s = 0; s < sels.length; s++) {
			var nodes = Array.prototype.slice.call(document.querySelectorAll(sels[s])).slice(0, 6);
			for (var i = 0; i < nodes.length; i++) {
				var t = normalizeSectionLabel(textOf(nodes[i]).replace(/^(作业标题|章节标题|课程名称|标题)\s*[:：]\s*/, ""));
				if (t.length < 4 || t.length > 80) continue;
				var exact = [], loose = [];
				for (var j = 0; j < items.length; j++) {
					var label = normalizeSectionLabel(items[j].text);
					var full = normalizeSectionLabel((items[j].groupTitle || "") + (items[j].text || ""));
					if (!label && !full) continue;
					if (t === label || t === full) exact.push(j);
					else if (label.length >= 6 && (t.indexOf(label) >= 0 || label.indexOf(t) >= 0)) loose.push(j);
					else if (full.length >= 6 && (t.indexOf(full) >= 0 || full.indexOf(t) >= 0)) loose.push(j);
				}
				if (exact.length === 1) return exact[0];
				if (!exact.length && loose.length === 1) return loose[0];
				// 命中 0 个或多个（例如「课后作业」在七章里都一样）：宁可不定位，绝不猜
			}
		}
		return -1;
	}
	var diagLogged = Object.create(null);
	function logDiag(key, text, ask) {
		if (diagLogged[key]) return;
		diagLogged[key] = 1;
		ask.log(text, "error");
	}
	// v3.4.8：折叠大章节的小节链接本来就在 DOM 里（只是 display:none），
	// 根本不需要点开。站点对 .group>.name 有事件委托（不写在 onclick 属性里，
	// 脚本检测不到），点「展开」很可能被当成「跳到大章节」——这是乱跳的最大嫌疑。
	// 因此本函数彻底只读：只记录哪些大章节暂时没有子节点，绝不点击任何标题。
	function expandCollapsedGroups() {
		if (isStopped()) return false;
		var groups = catalogGroups(catalogRoot());
		var empty = [];
		groups.forEach((g) => {
			var nameEl = g.querySelector(".name");
			var list = g.querySelector(".list");
			if (list && list.querySelectorAll(".item a,.item[data-node-id]").length) return;
			empty.push({
				group: nameEl ? textOf(nameEl).trim().slice(0, 24) : "",
				href: g.querySelector(".name a") ? (g.querySelector(".name a").getAttribute("href") || "") : ""
			});
		});
		if (empty.length) vlog("catalog", "发现 " + empty.length + " 个折叠大章节暂时没有子节点：只读记录，绝不点击标题（防止站点跳到大章节）", empty);
		else vlog("catalog", "目录检查：" + groups.length + " 个大章节的小节都已在 DOM 中，无需展开、无需点击", { groups: groups.length });
		return false;
	}
	function hasVideoContext() {
		if (findVideo()) return true;
		// 站点模板里的隐藏输入框：#video-file 有值说明这一节确实是视频节点
		var file = document.querySelector("#video-file");
		if (file && String(file.value || "").trim()) return true;
		var box = document.querySelector("#videoContent,.ckplayer,[class*='video-player']");
		if (box && box.querySelector("video,object,embed,iframe")) return true;
		return false;
	}
	// 所有切换（播完 / 无视频 / 播放失败）共用一套 10~20 秒随机等待；
	// 每处只随机生成一次并缓存，之后倒计时复用该值，避免面板数字来回跳动。
	function rollSwitchDelay() {
		var config = getConfig();
		var min = Number(config.switchDelayMinSec);
		var max = Number(config.switchDelayMaxSec);
		if (!Number.isFinite(min) || min < 1) min = 10;
		if (!Number.isFinite(max) || max < 1) max = 20;
		if (max < min) {
			var swap = min;
			min = max;
			max = swap;
		}
		var lo = Math.round(min * 1000);
		var hi = Math.round(max * 1000);
		return Math.round(lo + Math.random() * Math.max(0, hi - lo));
	}
	function switchDelayMs() {
		return runtime.switchDelayMs || rollSwitchDelay();
	}
	function markVideoEnded(ask) {
		if (runtime.videoEndedAt) return;
		runtime.videoEndedAt = Date.now();
		runtime.switchDelayMs = rollSwitchDelay();
		var human = formatSwitchDelay(runtime.switchDelayMs);
		var config = getConfig();
		ask.msg("视频已播放完毕，" + human + "后切换下一小节");
		ask.log("视频播放完毕，随机等待 " + human + "（" + config.switchDelayMinSec + "~" + config.switchDelayMaxSec + " 秒之间），预计 " + new Date(runtime.videoEndedAt + runtime.switchDelayMs).toLocaleTimeString() + " 切换", "success");
	}
	// 无视频 / 播放失败小节与正常播完共用同一套随机区间（各自独立随机一次）
	function rollNoVideoDelay() {
		return rollSwitchDelay();
	}
	function noVideoDelayMs() {
		if (!runtime.noVideoDelayMs) runtime.noVideoDelayMs = rollNoVideoDelay();
		return runtime.noVideoDelayMs;
	}
	function lastJumpAt() {
		try { return Number(pageWindow.sessionStorage.getItem(JUMP_KEY)) || 0; } catch (e) { return 0; }
	}
	function markJump() {
		try { pageWindow.sessionStorage.setItem(JUMP_KEY, String(Date.now())); } catch (e) {}
	}
	function lastTargetId() {
		try { return String(pageWindow.sessionStorage.getItem(TARGET_KEY) || ""); } catch (e) { return ""; }
	}
	function markTarget(nodeId) {
		try {
			pageWindow.sessionStorage.setItem(TARGET_KEY, String(nodeId));
			pageWindow.sessionStorage.setItem(TARGET_AT_KEY, String(Date.now()));
		} catch (e) {}
	}
	// 旧版本只写了 TARGET_KEY、没有时间戳：一律视为过期，绝不拿来定位
	function targetAgeMs() {
		var at = 0;
		try { at = Number(pageWindow.sessionStorage.getItem(TARGET_AT_KEY)) || 0; } catch (e) { return Infinity; }
		return at ? Date.now() - at : Infinity;
	}
	function targetValid() {
		return !!lastTargetId() && targetAgeMs() < TARGET_MAX_AGE_MS;
	}
	function clearStaleTarget() {
		try {
			pageWindow.sessionStorage.removeItem(TARGET_KEY);
			pageWindow.sessionStorage.removeItem(TARGET_AT_KEY);
		} catch (e) {}
	}
	// 大章节标题链接（.group > .name > a）绝不是小节。
	// 只认位于 .list/.item 叶子容器里的链接，面包屑、章节标题、其它导航一律排除。
	function isGroupHeaderLink(el) {
		if (!el || !el.closest) return true;
		if (el.closest(".name, .group-title, .chapter-title, .catalog-title, .chapter-name")) return true;
		if (!el.closest(".list, .item, .section-list, .node-list")) return true;
		return false;
	}
	/* 当前小节定位：只认「目录里真实存在的 nodeId」、目录高亮、刚切过来的目标、
	 * 或页面上能唯一命中的标题。定位不到就返回 -1，调用方必须停在本节。
	 * v3.4.4 起彻底删除按 nodeId 数值大小猜位置的兜底 —— 站点小节的
	 * nodeId 并不单调递增（作业节点的 id 可能比后面几章的视频都大），
	 * 按数值找「紧邻后继」正是从第二章课后作业直接跳到第七章课后作业的原因。 */
	function locateCurrent(items) {
		var current = currentNodeId();
		var index = current ? items.findIndex((e) => e.nodeId === current) : -1;
		if (index >= 0) {
			vlog("locate", "定位=URL nodeId，命中第 " + (index + 1) + "/" + items.length + " 节 " + items[index].nodeId, { how: "URL nodeId", current: current, index: index + 1, total: items.length, text: items[index].text });
			return { index: index, how: "URL nodeId", current: current };
		}
		// 目录高亮必须唯一；多个高亮（展开态 .group.on + 其它状态）一律不采信
		var highlighted = [];
		items.forEach((e, i) => { if (isCurrentEntry(e)) highlighted.push(i); });
		vlog("locate", "URL nodeId 未命中目录，目录高亮候选 " + highlighted.length + " 个", { current: current, highlighted: highlighted.map((i) => items[i].nodeId), total: items.length });
		if (highlighted.length === 1) {
			vlog("locate", "定位=唯一目录高亮，第 " + (highlighted[0] + 1) + " 节 " + items[highlighted[0]].nodeId, { how: "目录高亮", index: highlighted[0] + 1 });
			return { index: highlighted[0], how: "目录高亮", current: current };
		}
		// 上次切换目标只在刚刚自动切过来的短时间内可信；过期/陈旧值一律丢弃
		var jumpAge = Date.now() - lastJumpAt();
		var targetAge = targetAgeMs();
		if (targetValid() && jumpAge < TARGET_MAX_AGE_MS) {
			var target = lastTargetId();
			index = items.findIndex((e) => e.nodeId === target);
			vlog("locate", "尝试用「上次切换目标」定位：" + target + "（目标 " + Math.round(targetAge / 1000) + " 秒前写入，切换 " + Math.round(jumpAge / 1000) + " 秒前发起）", { target: target, ageSec: Math.round(targetAge / 1000), jumpAgeSec: Math.round(jumpAge / 1000) });
			if (index >= 0) return { index: index, how: "上次切换目标", current: current };
		} else if (lastTargetId()) {
			vlog("locate", "上次切换目标已过期，不采信", { target: lastTargetId(), ageSec: Number.isFinite(targetAge) ? Math.round(targetAge / 1000) : -1, jumpAgeSec: Math.round(jumpAge / 1000) });
		}
		var byTitle = matchByPageTitle(items);
		if (byTitle >= 0) {
			vlog("locate", "定位=页面标题唯一命中，第 " + (byTitle + 1) + " 节 " + items[byTitle].nodeId, { how: "页面标题", index: byTitle + 1, text: items[byTitle].text });
			return { index: byTitle, how: "页面标题", current: current };
		}
		vlog("locate", "无法定位当前节：停在本节，绝不按 nodeId 猜位置", { current: current, total: items.length, first3: items.slice(0, 3).map((e) => e.nodeId) }, "error");
		return { index: -1, how: "未定位", current: current };
	}
	var runtime = {
		busy: false,
		url: "",
		quizSignature: "",
		lastAdvance: 0,
		pageEnterAt: Date.now(),
		timer: null,
		videoKey: "",
		videoEndedAt: 0,
		switchDelayMs: 0,
		finishedVideoKey: "",
		// 本节随机等待（无视频/失败时切下一节用）与播完倒计时各自缓存一次随机值
		noVideoDelayMs: 0,
		skipReason: "",
		boundaryLogged: false,
		playAttemptKey: "",
		playAttemptFailed: false,
		playAttemptBlocked: false,
		playWatchSince: 0,
		// v3.4.7：导航锁 + 目录稳定期，防止「页面还没卸载就再次发起切换」和
		// 「目录异步渲染还没完成，按半份目录算出错误的紧邻节」
		navigating: false,
		navigateAt: 0,
		navigateFrom: "",
		navigateTo: "",
		catalogFp: "",
		catalogFpSince: 0,
		catalogUnstableSince: 0,
		loopSeq: 0
	};
	var CATALOG_STABLE_MS = 3e3;
	var NAVIGATE_TIMEOUT_MS = 15e3;
	function formatSwitchDelay(milliseconds) {
		var seconds = Math.max(0, Math.round(milliseconds / 1000));
		if (seconds < 60) return seconds + " 秒";
		return Math.floor(seconds / 60) + " 分 " + (seconds % 60) + " 秒";
	}
	function ensureVideoTiming(video) {
		var videoKey = location.href + "|" + (video.currentSrc || video.src || "");
		if (runtime.videoKey !== videoKey) {
			var prev = runtime.videoKey;
			runtime.videoKey = videoKey;
			runtime.videoEndedAt = 0;
			runtime.switchDelayMs = 0;
			runtime.finishedVideoKey = "";
			runtime.noVideoDelayMs = 0;
			// v3.4.7：URL 没变但视频源换了（站点原地换节 / 播放器重建）。
			// 旧节的「无视频 / 播放失败 / 已点过播放」状态必须清掉并重新计时，
			// 否则会沿用上一节的结论，在 3 秒内把新节直接切走。
			if (prev) {
				runtime.pageEnterAt = Date.now();
				runtime.skipReason = "";
				runtime.playAttemptKey = "";
				runtime.playAttemptFailed = false;
				runtime.playAttemptBlocked = false;
				runtime.playWatchSince = 0;
				runtime.boundaryLogged = false;
				vlog("guard", "本页视频源发生变化但 URL 未变：已重置本节状态并重新开始加载窗口", { previous: prev, current: videoKey });
			}
		}
		return videoKey;
	}
	function isVideoFinished(video) {
		return !!video && (video.ended || video.duration > 0 && video.currentTime >= video.duration - .5);
	}
	function advanceChapter(reason, force) {
		var ask0 = ui.ask;
		var enterData = { reason: reason || "", force: !!force, url: location.href, pageDwellSec: Math.round((Date.now() - runtime.pageEnterAt) / 1000), skipReason: runtime.skipReason };
		vlog("switch", "进入切换判断 advanceChapter", enterData);
		if (isStopped()) {
			if (ask0) logDiag("stopped", "助手处于手动停止状态，不会切换；点浮层「我已处理，继续运行」或执行 __mfResume() 恢复", ask0);
			vlog("block", "阻止切换：助手处于手动停止状态", enterData, "error");
			return false;
		}
		var ask = ui.ask;
		var config = getConfig();
		if (!config.enabled) {
			if (ask) logDiag("disabled", "面板里「助手」总开关是关闭状态，不会切换；请打开后刷新页面", ask);
			vlog("block", "阻止切换：面板总开关关闭", enterData, "error");
			return false;
		}
		if (!config.autoJump) {
			if (ask) logDiag("autojump-off", "面板里「自动切换」已关闭，不会跳到下一小节；请打开该开关", ask);
			vlog("block", "阻止切换：自动切换开关关闭", enterData, "error");
			return false;
		}
		// v3.4.7：上一次导航还没落地（整页刷新前的几秒里 loop 仍在跑），
		// 绝不允许发起第二次切换，否则会按同一份目录连续跳到不同目标。
		if (runtime.navigating) {
			vlog("block", "阻止切换：上一次导航尚未落地，导航锁生效", { to: runtime.navigateTo, sinceSec: Math.round((Date.now() - runtime.navigateAt) / 1000) });
			return false;
		}
		var playingVideo = findVideo();
		// force = 本节不可用（无视频 / 播放失败）：跳过「必须播完 + 播完等待」的守卫，直接往后切
		if (!force) {
			var vstate = playingVideo ? { paused: playingVideo.paused, ended: playingVideo.ended, currentTime: Math.round(playingVideo.currentTime || 0), duration: Math.round(playingVideo.duration || 0), finished: isVideoFinished(playingVideo) } : null;
			vlog("switch", "播完守卫检查（非强制切换）", { video: vstate, videoEndedAt: runtime.videoEndedAt, switchDelayMs: switchDelayMs() });
			if (playingVideo && !isVideoFinished(playingVideo)) {
				ask.msg("视频尚未播放完毕，不会切换下一小节");
				vlog("block", "阻止切换：视频尚未播放完毕", vstate);
				return false;
			}
			if (playingVideo && isVideoFinished(playingVideo) && !runtime.videoEndedAt) {
				markVideoEnded(ask);
				vlog("block", "阻止切换：刚检测到播完，开始 " + formatSwitchDelay(runtime.switchDelayMs) + " 倒计时", { videoEndedAt: runtime.videoEndedAt });
				return false;
			}
			if (runtime.videoEndedAt) {
				var remaining = Math.max(0, switchDelayMs() - (Date.now() - runtime.videoEndedAt));
				if (remaining > 0) {
					ask.msg("视频已播放完毕，还需等待 " + formatSwitchDelay(remaining) + " 切换");
					vlog("block", "阻止切换：播完倒计时还剩 " + formatSwitchDelay(remaining), { totalMs: switchDelayMs() });
					return false;
				}
			}
		}
		// 切小节是整页刷新，runtime 会被清空：用 sessionStorage 做跨页面防连跳
		var jumpAge = Date.now() - lastJumpAt();
		if (jumpAge < 8e3) {
			vlog("block", "阻止切换：跨页防连跳冷却中（" + Math.round((8e3 - jumpAge) / 1000) + " 秒后解除）", { jumpAgeSec: Math.round(jumpAge / 1000) });
			return false;
		}
		var advanceAge = Date.now() - runtime.lastAdvance;
		if (advanceAge < 8e3) {
			vlog("block", "阻止切换：本页 8 秒防连跳冷却中（" + Math.round((8e3 - advanceAge) / 1000) + " 秒后解除）", { advanceAgeSec: Math.round(advanceAge / 1000) });
			return false;
		}
		var dwell = Date.now() - runtime.pageEnterAt;
		if (dwell < noVideoDelayMs()) {
			ask.msg("本节还需停留 " + Math.ceil((noVideoDelayMs() - dwell) / 1000) + " 秒再切下一小节");
			vlog("block", "阻止切换：本节停留时间未到（" + Math.round(dwell / 1000) + "/" + Math.round(noVideoDelayMs() / 1000) + " 秒）", { dwellSec: Math.round(dwell / 1000), needSec: Math.round(noVideoDelayMs() / 1000) });
			return false;
		}
		var items = catalog();
		// v3.4.7：目录仍在异步渲染时按半份目录切，会直接落到很远的章节
		if (!catalogStable(items)) {
			ask.msg("课程目录还在加载，暂不切换");
			vlog("block", "阻止切换：课程目录指纹尚未稳定（避免按不完整目录跳错章）", { total: items.length, stableMs: Date.now() - runtime.catalogFpSince, needMs: CATALOG_STABLE_MS }, "error");
			return false;
		}
		vlog("switch", "目录已稳定，开始定位当前节", { total: items.length, fingerprint: catalogFingerprint(items).slice(0, 180), dwellSec: Math.round(dwell / 1000) });
		// 只定位、不猜位置；定位不到就停在本节，绝不按 nodeId 数值找「后继」
		var locate = locateCurrent(items);
		var index = locate.index;
		var current = locate.current;
		var how = locate.how;
		if (index < 0) {
			ask.msg(items.length ? "无法定位当前小节，已停在本节（不会乱跳）" : "未识别到课程目录小章节");
			logDiag("locate", "无法定位当前节：URL nodeId=" + (current || "无") + "，识别到 " + items.length + " 个小章节，前 3 个 nodeId=" + items.slice(0, 3).map((e) => e.nodeId).join(",") + "；已禁用按数值猜位置，请在控制台执行 __mfCatalog() 核对目录、__mfDiag() 查看状态", ask);
			vlog("block", "阻止切换：无法定位当前节（不按 nodeId 猜位置）", { current: current, total: items.length, first3: items.slice(0, 3).map((e) => e.nodeId) }, "error");
			return false;
		}
		var cur = items[index];
		vlog("switch", "当前节 = 第 " + (index + 1) + "/" + items.length + " 节（" + cur.nodeId + "），定位方式=" + how, { seq: index + 1, total: items.length, nodeId: cur.nodeId, group: cur.groupTitle, text: cur.text, how: how, urlId: current });
		// 唯一允许的切换目标：目录顺序里紧挨着的下一项。
		// 不按 nodeId 数值排序、不过滤「数值变小」的节、不跳过任何一项、不越过锁定节，
		// 也不跨多个大章节去找后继。v3.4.3 的「数值防回跳」会在作业页 nodeId 偏大时
		// 把后面几章全部 continue 掉，一路找到第七章课后作业 —— 这正是本次要修的问题。
		var next = items[index + 1] || null;
		if (!next || next.nodeId === cur.nodeId) {
			runtime.lastAdvance = Date.now();
			ask.msg("已是最后一小节（" + reason + "）");
			ask.log("全部小章节已处理完成", "success");
			vlog("block", "阻止切换：已到目录最后一小节", { seq: index + 1, total: items.length });
			return false;
		}
		// v3.4.7：作业/测验页 URL nodeId 与目录不一致时，若算出的下一节恰好就是
		// 当前页自己，说明定位锚错了节，跳过去只会原地刷新来回打转。
		var urlId = currentNodeId();
		if (urlId && next.nodeId === urlId) {
			runtime.lastAdvance = Date.now();
			ask.msg("切换目标就是当前页面，已阻止空跳转");
			vlog("block", "阻止切换：紧邻目标 nodeId 与当前页 URL 相同，疑似定位到上一节", { urlId: urlId, cur: cur.nodeId, next: next.nodeId, how: how }, "error");
			return false;
		}
		// 目标 href 里的 nodeId 必须与目录算出的 nodeId 一致，避免拼错地址跳到别处
		var hrefId = nodeIdOf(next.href);
		if (hrefId && hrefId !== next.nodeId) {
			runtime.lastAdvance = Date.now();
			ask.msg("切换目标地址异常，已阻止");
			vlog("block", "阻止切换：目标链接与目录 nodeId 不一致", { next: next.nodeId, hrefId: hrefId, href: next.href }, "error");
			return false;
		}
		vlog("switch", "候选下一节 = 第 " + (index + 2) + "/" + items.length + " 节（" + next.nodeId + "），" + (next.groupIndex !== cur.groupIndex ? "章末跨到下一章" : "本章内"), { seq: index + 2, total: items.length, nodeId: next.nodeId, group: next.groupTitle, text: next.text, groupIndex: next.groupIndex, href: next.href, locked: next.locked });
		// 紧邻的下一小节被锁定：停在原地，绝不越过它跳到更远的小节
		if (next.locked) {
			runtime.lastAdvance = Date.now();
			ask.msg("下一小节尚未解锁，暂不切换");
			ask.log("后续小节处于锁定状态，暂不切换", "error");
			vlog("block", "阻止切换：紧邻下一节被锁定", { next: next.nodeId, text: next.text }, "error");
			return false;
		}
		// 跨章硬约束：最多只允许「本章最后一节 -> 紧邻下一大章节的第一节」。
		// 任何跨 2 章以上、往回跳、或落到下一章非首节的情况一律拒绝。
		var gi = cur.groupIndex, gn = next.groupIndex;
		vlog("switch", "跨章约束检查：当前第 " + (gi + 1) + " 章 → 目标第 " + (gn + 1) + " 章", { gi: gi, gn: gn, autoNextChapter: config.autoNextChapter, curSeq: index + 1, nextSeq: index + 2 });
		if (gi >= 0 && gn >= 0 && (gn < gi || gn > gi + 1)) {
			runtime.lastAdvance = Date.now();
			ask.msg("目录顺序异常：下一节跨了多个大章节，已阻止切换");
			logDiag("crossgroup", "已阻止跨章跳转：当前「" + (cur.groupTitle || "") + "」第 " + (gi + 1) + " 章第 " + (index + 1) + " 节，紧邻项却是第 " + (gn + 1) + " 章的「" + (next.text || "") + "」。请执行 __mfCatalog() 核对目录顺序", ask);
			vlog("block", "★ 已阻止跨多章跳转：第 " + (gi + 1) + " 章 → 第 " + (gn + 1) + " 章", { cur: cur.nodeId, next: next.nodeId, how: how }, "error");
			return false;
		}
		if (gi >= 0 && gn === gi + 1) {
			var firstOfNextGroup = items.findIndex((e) => e.groupIndex === gn);
			if (firstOfNextGroup !== index + 1) {
				runtime.lastAdvance = Date.now();
				ask.msg("下一章不是从第一节开始，已阻止切换");
				logDiag("notfirst", "已阻止跨章跳转：下一章第一节并非目录里的紧邻项，请执行 __mfCatalog() 核对", ask);
				vlog("block", "★ 已阻止跨章跳转：目标不是下一章第一节", { firstOfNextGroup: firstOfNextGroup + 1, expected: index + 2 }, "error");
				return false;
			}
			// 章末（如「第X章课后作业」）默认允许切到紧邻下一章的第一小节。
			// 仍是一次只切一个紧邻小节，绝不点击大章节标题、也不跳过大章节。
			if (config.autoNextChapter === false) {
				runtime.lastAdvance = Date.now();
				ask.msg("本章小章节已完成，按设置不进入下一章");
				if (!runtime.boundaryLogged) {
					runtime.boundaryLogged = true;
					ask.log("当前大章节「" + (cur.groupTitle || "") + "」已是最后一小节；如需继续，请打开面板里的「章末进入下一章」", "success");
				}
				vlog("block", "阻止切换：面板关闭了「章末进入下一章」", { cur: cur.nodeId, next: next.nodeId }, "error");
				return false;
			}
		}
		// v3.4.8：多开课程页时只允许一个页面发起自动切换，避免互相抢跳
		var leaseDecision = canSwitchNow();
		if (!leaseDecision.ok) {
			ask.msg("已阻止切换：检测到多个课程页同时运行");
			vlog("block", "阻止切换：另一个课程标签页正在自动切换（单实例锁）", leaseDecision, "error");
			return false;
		}
		vlog("switch", "单标签页切换锁检查通过：" + leaseDecision.why, leaseDecision);
		runtime.lastAdvance = Date.now();
		runtime.navigating = true;
		runtime.navigateAt = Date.now();
		runtime.navigateFrom = location.href;
		runtime.navigateTo = next.href;
		markJump();
		markTarget(next.nodeId);
		vlog("navigate", "写入跨页状态：lastJump / lastTarget 已更新", { JUMP_KEY: JUMP_KEY, TARGET_KEY: TARGET_KEY, target: next.nodeId, targetMaxAgeSec: TARGET_MAX_AGE_MS / 1000, from: runtime.navigateFrom, to: next.href });
		runtime.boundaryLogged = false;
		// 万一站点不整页刷新而是原地换视频，也把「本节跳过 / 已点过播放」的状态清干净
		runtime.skipReason = "";
		runtime.playAttemptKey = "";
		runtime.playAttemptFailed = false;
		runtime.playAttemptBlocked = false;
		runtime.playWatchSince = 0;
		runtime.noVideoDelayMs = 0;
		var label = (next.groupTitle ? next.groupTitle + " › " : "") + (next.text || next.nodeId);
		var scope = gn !== gi ? "章末进入第 " + (gn + 1) + " 章第一节" : "本章内";
		ask.msg("已切换紧邻下一小节：" + label.slice(0, 36));
		ask.log("切换第 " + (index + 1) + "/" + items.length + " 节 → 第 " + (index + 2) + "/" + items.length + " 节：" + label.slice(0, 60) + "（" + scope + "，nodeId=" + next.nodeId + "，定位=" + how + "，" + reason + "）", "success");
		vlog("switch", "★ 发起切换：第 " + (index + 1) + "/" + items.length + " 节（" + cur.nodeId + "）→ 第 " + (index + 2) + "/" + items.length + " 节（" + next.nodeId + "）", {
			reason: reason, force: !!force, how: how, scope: scope,
			from: { seq: index + 1, nodeId: cur.nodeId, group: cur.groupTitle, text: cur.text, groupIndex: gi + 1 },
			to: { seq: index + 2, nodeId: next.nodeId, group: next.groupTitle, text: next.text, groupIndex: gn + 1, href: next.href },
			urlBefore: location.href, dwellSec: Math.round(dwell / 1000), catalogTotal: items.length,
			captchaMode: captchaMode(), verboseLog: config.verboseLog
		}, "success");
		// 一律按目录算出的 nodeId 直接导航，不再触发站点链接自己的点击逻辑，
		// 避免 onclick / 父级委托把这次切换带到别的大章节。
		pageWindow.location.href = next.href;
		return true;
	}
	async function videoStep() {
		if (isStopped()) return;
		var ask = ui.ask;
		var config = getConfig();
		// v3.4.8：验证码由本人填写。弹窗还在时本轮完全不动作 —— 不切节、
		// 不判播放失败、不点播放按钮、不关弹窗（关掉会毁掉输码入口）。
		// 不设全局等待状态：弹窗一消失，下一轮自动恢复播放与切换，不会卡死。
		if (captchaPresent()) {
			noteCaptchaSeen();
			ask.task.name = "等待本人验证";
			ask.msg("⏸ 等待本人输入验证码：助手不碰弹窗，填完点「开始播放」后自动继续");
			vlog("captcha", "本轮暂停所有自动动作：验证码弹窗仍在（本人填写中）", { seenTotal: captchaGuard.seenTotal, popup: true });
			return;
		}
		vlog("video", "videoStep 开始：本轮视频任务检查", { url: location.href, dwellSec: Math.round((Date.now() - runtime.pageEnterAt) / 1000), skipReason: runtime.skipReason, videoKey: runtime.videoKey, navigating: runtime.navigating, captchaMode: captchaMode() });
		closeDialogs();
		if (isStopped()) return;
		// 本节已被判定不可用：只负责切下一小节，绝不再碰这个视频、绝不重复点击播放
		if (runtime.skipReason) {
			var left = Math.max(0, noVideoDelayMs() - (Date.now() - runtime.pageEnterAt));
			ask.task.name = "跳过本节";
			ask.msg("本节" + runtime.skipReason + "，" + (left > 0 ? Math.ceil(left / 1000) + " 秒后" : "即将") + "切下一小节");
			vlog("skip", "本节已标记「" + runtime.skipReason + "」，只尝试切到紧邻下一节", { leftSec: Math.ceil(left / 1000), needSec: Math.round(noVideoDelayMs() / 1000) });
			if (config.autoJump) advanceChapter(runtime.skipReason, true);
			return;
		}
		var video = findVideo();
		if (!video) {
			// CKPlayer 的 <video> 异步挂载：给 10~20 秒加载窗口，期间出现视频就正常播放；
			// 到时仍没有视频即判「本节无视频」，直接切下一节，不再等 60 秒、也不重试点击。
			var wait = noVideoDelayMs();
			var dwell = Date.now() - runtime.pageEnterAt;
			if (dwell < wait) {
				ask.task.name = "视频加载中";
				ask.msg("等待视频加载，" + Math.ceil((wait - dwell) / 1000) + " 秒后仍无视频则切下一小节");
				vlog("video", "本页暂无 <video>，等待 CKPlayer 异步挂载", { dwellSec: Math.round(dwell / 1000), waitSec: Math.round(wait / 1000), hasContext: hasVideoContext() });
				return;
			}
			ask.task.name = "小节";
			if (config.autoJump && config.skipOnFail) {
				skipCurrentSection("无视频", "等待 " + Math.round(wait / 1000) + " 秒后播放器仍未挂载 <video>");
				vlog("skip", "判定本节无视频，准备跳到紧邻下一节", { waitSec: Math.round(wait / 1000), hasContext: hasVideoContext() });
				advanceChapter(runtime.skipReason, true);
			} else {
				ask.msg("当前小节无视频（自动跳过已关闭）");
				logDiag("skipoff", "「失败自动跳下一节」或「自动切换」处于关闭状态，本节不会自动切走；请在面板里打开这两项", ask);
			}
			return;
		}
		ask.task.name = "视频";
		ask.task.video.status = 1;
		var videoKey = ensureVideoTiming(video);
		vlog("video", "播放器状态快照", {
			videoKey: videoKey, paused: video.paused, ended: video.ended,
			currentTime: Math.round(video.currentTime || 0), duration: Math.round(video.duration || 0),
			readyState: video.readyState, error: video.error ? video.error.code : null,
			rate: video.playbackRate, muted: video.muted, finished: isVideoFinished(video)
		});
		// 播放器已经报错（含播放中途失败）：直接跳过本节，不做任何重试
		if (video.error) {
			if (config.skipOnFail) {
				skipCurrentSection("播放失败", "MediaError code=" + video.error.code);
				if (config.autoJump) advanceChapter(runtime.skipReason, true);
			}
			return;
		}
		var rate = Number(config.playbackRate) || 1;
		if (config.antiRewind && rate > 1.05) {
			installAntiRewind();
			antiRewind.on = true;
			installToastMute();
		} else {
			antiRewind.on = false;
		}
		if (config.muted && !video.muted) video.muted = true;
		if (config.forceRate) {
			if (video.playbackRate !== rate) lockRate(video, rate);
		} else {
			unlockRate(video);
			if (video.playbackRate !== rate) {
				try {
					video.playbackRate = rate;
				} catch (e) {}
			}
		}
		// 本节只点一次播放；失败不重试、不停止脚本，直接切下一小节
		var attempt = await ensurePlaying(video, config, ask, videoKey);
		vlog("video", "ensurePlaying 结果 = " + attempt, { videoKey: videoKey, playAttemptKey: runtime.playAttemptKey, failed: runtime.playAttemptFailed, blocked: runtime.playAttemptBlocked, paused: video.paused, currentTime: Math.round(video.currentTime || 0) });
		if (isStopped()) return;
		if (attempt === "failed") {
			if (config.skipOnFail) {
				skipCurrentSection("播放失败", "点击播放后仍无法播放");
				if (config.autoJump) advanceChapter(runtime.skipReason, true);
			}
			return;
		}
		if (attempt === "blocked") {
			ask.msg("浏览器拦截了自动播放，请手动点击页面一次（本视频不再重复点击）");
			return;
		}
		if (attempt === "pending") {
			ask.msg("已点击播放，等待视频起播（不会重复点击）");
			return;
		}
		ask.msg((config.autoVideo ? "视频任务运行中 " : "自动播放已关闭 ") + video.playbackRate.toFixed(2) + "x" + (antiRewind.on ? " · 已拦截回拽 " + antiRewind.blocked : ""));
		var finished = isVideoFinished(video);
		if (finished) {
			vlog("video", "检测到视频已播完，进入播完等待与切换判断", { currentTime: Math.round(video.currentTime || 0), duration: Math.round(video.duration || 0), videoEndedAt: runtime.videoEndedAt, waitMs: switchDelayMs() });
			if (runtime.finishedVideoKey !== videoKey) {
				runtime.finishedVideoKey = videoKey;
				markVideoEnded(ask);
			}
			if (config.autoJump) advanceChapter("播放结束");
		} else {
			vlog("video", "视频播放中，未触发切换", { currentTime: Math.round(video.currentTime || 0), duration: Math.round(video.duration || 0), percent: video.duration ? Math.round(video.currentTime / video.duration * 100) : 0 });
		}
	}

	/* ---------------- 6.3 题目解析 ---------------- */
	var TYPE_MAP = {
		"单选题": "0",
		"多选题": "1",
		"填空题": "2",
		"判断题": "3",
		"简答题": "4",
		"名词解释": "5",
		"论述题": "6",
		"计算题": "7"
	};
	var JUDGE = {
		"正确": "正确",
		"对的": "正确",
		"对": "正确",
		"是": "正确",
		"true": "正确",
		"t": "正确",
		"y": "正确",
		"√": "正确",
		"错误": "错误",
		"错的": "错误",
		"错": "错误",
		"否": "错误",
		"false": "错误",
		"f": "错误",
		"n": "错误",
		"×": "错误",
		"x": "错误"
	};
	function normalizeForMatch(text) {
		return String(text == null ? "" : text).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").replace(/\s+/g, "").replace(/[，。；：、！？,.;:!?"'“”‘’（）()【】\[\]{}<>《》…—\-_·|\\\/~`@#$%^&*=+]/g, "").toLowerCase();
	}
	function stripOptionPrefix(text) {
		return String(text || "").replace(/^[\s]*[（(]?[A-Ha-h][)）.、．:：][\s]*/, "").replace(/\s+/g, " ").trim();
	}
	function cleanStem(text) {
		return String(text || "").replace(/【[^】]{0,12}题】/g, " ").replace(/^\s*\d+[.、．]\s*/, "").replace(/[（(]\s*\d+(?:\.\d+)?\s*分\s*[)）]\s*$/g, "").replace(/\s+/g, " ").trim();
	}
	function findBlocks() {
		// 1) 显式选择器
		for (var i = 0; i < SITE.question.length; i++) {
			var list = Array.prototype.slice.call(document.querySelectorAll(SITE.question[i])).filter(isVisible);
			if (!list.length) continue;
			var blocks = innermost(list).filter((el) => {
				var controls = el.querySelectorAll("input[type='radio'],input[type='checkbox']").length;
				return controls >= 2 || !!el.querySelector(SITE.textbox.join(","));
			});
			if (blocks.length) return blocks;
		}
		// 2) 兜底：把同一组单/多选的 input 归为一道题
		//    优先用 Element 的 .el-radio-group 容器，其次用原生 name，最后用题目容器 class
		var controls2 = Array.prototype.slice.call(document.querySelectorAll("input[type='radio'],input[type='checkbox']")).filter(isVisible);
		if (!controls2.length) return [];
		var groups = new Map();
		controls2.forEach((input) => {
			var group = input.closest(".el-radio-group,.el-checkbox-group,[role='radiogroup']");
			var container = input.closest("[class*='question'],[class*='subject'],[class*='timu'],[class*='topic']");
			var key = group ? "g:" + nodeKey(group) : input.name ? "n:" + input.name : container ? "c:" + nodeKey(container) : "";
			if (!key) return;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(input);
		});
		var result = [];
		groups.forEach((inputs) => {
			if (inputs.length < 2) return;
			var block = commonAncestor(inputs);
			if (!block) return;
			// 向上扩，把题干一起纳入（父节点若没有引入新的一组 input 就继续上移）
			for (var step = 0; step < 4; step++) {
				var parent = block.parentElement;
				if (!parent || parent === document.body) break;
				if (parent.querySelectorAll("input[type='radio'],input[type='checkbox']").length !== inputs.length) break;
				block = parent;
			}
			if (!result.some((item) => item === block || item.contains(block) || block.contains(item))) result.push(block);
		});
		return result;
	}
	function parseOptions(block) {
		var inputs = Array.prototype.slice.call(block.querySelectorAll("input[type='radio'],input[type='checkbox']")).filter(isVisible);
		if (inputs.length >= 2) {
			return inputs.map((input) => {
				var holder = input.closest("label,.el-radio,.el-checkbox,.option-item,.answer-item,li") || input.parentElement || input;
				return {
					text: stripOptionPrefix(textOf(holder)),
					el: holder,
					input
				};
			}).filter((option) => option.el);
		}
		var nodes = [];
		SITE.option.forEach((selector) => {
			block.querySelectorAll(selector).forEach((node) => {
				if (!isVisible(node)) return;
				var text = stripOptionPrefix(textOf(node));
				if (!text || text.length > 400) return;
				nodes.push({
					text,
					el: node,
					input: null
				});
			});
		});
		if (!nodes.length) return [];
		return innermost(nodes.map((n) => n.el)).map((el) => ({
			text: stripOptionPrefix(textOf(el)),
			el,
			input: null
		}));
	}
	function extractStem(block, optionTexts) {
		var lines = String(textOf(block) || "").split("\n").map((line) => line.trim()).filter(Boolean);
		var cut = lines.length;
		for (var i = 0; i < lines.length; i++) {
			if (/^[（(]?[A-Ha-h][)）.、．]/.test(lines[i]) || optionTexts.indexOf(stripOptionPrefix(lines[i])) !== -1) {
				cut = i;
				break;
			}
		}
		return lines.slice(0, cut).join(" ");
	}
	function detectType(block, stem) {
		var text = stem + " " + String(textOf(block)).slice(0, 200);
		for (var name in TYPE_MAP) {
			if (text.indexOf(name) !== -1) return TYPE_MAP[name];
		}
		var checkboxes = block.querySelectorAll("input[type='checkbox'],.el-checkbox").length;
		var radios = block.querySelectorAll("input[type='radio'],.el-radio").length;
		if (checkboxes >= 2) return "1";
		if (radios >= 1) return "0";
		return "4";
	}
	function parseQuestion(block, index) {
		var optionNodes = parseOptions(block);
		var optionTexts = optionNodes.map((option) => option.text);
		var stemEl = firstMatch(block, SITE.stem, isVisible) || firstMatch(block, SITE.stem);
		var stem = cleanStem(stemEl ? textOf(stemEl) : extractStem(block, optionTexts));
		return {
			question: stem || "第 " + (index + 1) + " 题",
			options: optionTexts,
			// markRaw：DOM 节点不要被 Vue 的 reactive 包成 Proxy，否则 click/checked 会出怪问题
			optionNodes: vue.markRaw(optionNodes),
			type: detectType(block, stem),
			dom: vue.markRaw(block)
		};
	}
	function pickOptionIndexes(answer, question) {
		var options = question.optionNodes || [];
		var judge = question.type === "3";
		var picked = [];
		var list = Array.isArray(answer) ? answer : [answer];
		list.forEach((raw) => {
			var text = String(raw == null ? "" : raw).replace(/^(正确答案|参考答案|答案)\s*[:：]?\s*/g, "").trim();
			if (!text) return;
			// a) 纯字母（A / AB / A,B / A、B）
			var letters = text.toUpperCase().replace(/[^A-H]/g, "");
			var bare = text.replace(/[\s,，、;；\/|#＆&]/g, "");
			if (letters && letters.length === bare.length && letters.length <= options.length) {
				letters.split("").forEach((letter) => {
					var index = letter.charCodeAt(0) - 65;
					if (index >= 0 && index < options.length && picked.indexOf(index) === -1) picked.push(index);
				});
				return;
			}
			// b) “A. 选项内容” 这种带前缀的答案
			var lead = text.match(/^([A-H](?:[\s,，、;；]*[A-H])*)[\s.、．)）:：]/i);
			if (lead) {
				lead[1].toUpperCase().replace(/[^A-H]/g, "").split("").forEach((letter) => {
					var index = letter.charCodeAt(0) - 65;
					if (index >= 0 && index < options.length && picked.indexOf(index) === -1) picked.push(index);
				});
				return;
			}
			// c) 文本匹配
			var target = normalizeForMatch(text);
			if (!target) return;
			if (judge && JUDGE[target]) target = JUDGE[target];
			var found = -1;
			options.forEach((option, index) => {
				if (found !== -1) return;
				var optionText = normalizeForMatch(option.text);
				if (judge && JUDGE[optionText]) optionText = JUDGE[optionText];
				if (!optionText) return;
				if (optionText === target || target.length > 3 && (optionText.indexOf(target) !== -1 || target.indexOf(optionText) !== -1)) found = index;
			});
			if (found !== -1 && picked.indexOf(found) === -1) picked.push(found);
		});
		return picked;
	}
	function selectOption(option) {
		var input = option.input;
		if (input && input.checked) return true;
		clickEl(option.el);
		if (input && !input.checked) {
			setNativeChecked(input, true);
			dispatch(input, "input");
			dispatch(input, "change");
		}
		return !input || input.checked;
	}
	function applyAnswer(question, picked, rawAnswer) {
		var options = question.optionNodes || [];
		if (picked.length) {
			var applied = [];
			picked.forEach((index) => {
				var option = options[index];
				if (!option) return;
				if (selectOption(option)) applied.push(option.text || String(index + 1));
			});
			return applied.length ? applied : false;
		}
		if (["0", "1", "3"].indexOf(question.type) !== -1) return false;
		var boxes = Array.prototype.slice.call(question.dom.querySelectorAll(SITE.textbox.join(","))).filter(isVisible);
		if (!boxes.length || !rawAnswer) return false;
		var parts = Array.isArray(rawAnswer) ? rawAnswer : String(rawAnswer).split(/\n|；|;|第\s*\d+\s*空[:：]/);
		parts = parts.map((part) => cleanStem(String(part || ""))).filter(Boolean);
		if (!parts.length) return false;
		boxes.forEach((box, index) => {
			var value = parts[index] != null ? parts[index] : parts[0];
			if (box.isContentEditable && !box.value) {
				box.textContent = value;
				dispatch(box, "input");
			} else setNativeValue(box, value);
		});
		return parts;
	}
	function fillFromSources(sources, question) {
		for (var i = 0; i < sources.length; i++) {
			var answer = sources[i].answer;
			if (!answer) continue;
			if (typeof answer === "string" && (/付费题库|暂无答案/.test(answer) || answer.trim() === "略")) continue;
			var picked = ["0", "1", "3"].indexOf(question.type) !== -1 ? pickOptionIndexes(answer, question) : [];
			var applied = applyAnswer(question, picked, answer);
			if (applied) return applied;
		}
		return false;
	}

	/* ---------------- 6.4 答题流程 ---------------- */
	async function quizStep() {
		var ask = ui.ask;
		var config = getConfig();
		var blocks = findBlocks();
		if (!blocks.length) {
			ask.msg("当前页面未识别到题目");
			return;
		}
		var signature = blocks.map((block) => String(textOf(block)).slice(0, 40)).join("|");
		if (signature === runtime.quizSignature) return;
		runtime.quizSignature = signature;
		ask.reset();
		ask.count = blocks.length;
		ask.task.name = /考试|exam|test/i.test(location.pathname) ? "考试" : "章节测验";
		ask.log("识别到 " + blocks.length + " 道题目，开始检索答案", "success");
		var matched = 0;
		for (var i = 0; i < blocks.length; i++) {
			await sleep(Math.max(1, Number(config.answerInterval) || 3));
			var question = parseQuestion(blocks[i], i);
			ask.insert(question);
			var item = ask.get(i);
			item.status = "primary";
			ask.task.work.inx = i;
			ask.msg("正在检索第 " + (i + 1) + " / " + blocks.length + " 题");
			var sources = await getAnswers(question);
			item.allAnswer = sources;
			var applied = fillFromSources(sources, question);
			if (applied) {
				item.status = "primary";
				item.answer = applied;
				matched++;
				ask.log("第 " + (i + 1) + " 题已自动填写", "success");
			} else {
				item.status = "danger";
				item.answer = "暂无答案";
				ask.log("第 " + (i + 1) + " 题未匹配到答案", "error");
			}
		}
		var ratio = blocks.length ? matched / blocks.length : 0;
		ask.task.status = "已处理 " + matched + " / " + blocks.length + " 题";
		if (!config.autoSubmit) {
			ask.log("答题结束（匹配 " + matched + " / " + blocks.length + "），未开启自动提交", "success");
		} else if (ratio < Number(config.minAccuracy || .8)) {
			ask.log("匹配率不足（" + matched + " / " + blocks.length + "），未自动提交", "error");
		} else {
			var submit = findButtonByText(SITE.submitText, SITE.nextButton);
			if (submit) {
				clickEl(submit);
				ask.log("已自动提交答卷", "success");
			} else ask.log("未找到提交按钮，请手动提交", "error");
		}
		if (config.autoExam || !/考试/.test(ask.task.name)) {
			var next = findButtonByText(SITE.nextText, SITE.nextButton);
			if (next) {
				clickEl(next);
				ask.log("切换到下一题", "success");
			}
		}
	}

	/* ---------------- 6.5 主循环 ---------------- */
	function detectMode() {
		if (findVideo() || hasVideoContext()) return "study";
		if (catalog().length > 0) return "study";
		if (document.querySelector("input[type='radio'],input[type='checkbox']") && findBlocks().length) return "quiz";
		return "idle";
	}
	async function step() {
		if (runtime.busy || isStopped()) return;
		// v3.4.7：导航已发起但页面还没卸载（整页刷新前 loop 仍在跑几秒），
		// 本轮绝不重复发起切换，避免同一份目录连续跳到不同目标。
		if (runtime.navigating) {
			if (runtime.url && runtime.url !== location.href) {
				vlog("navigate", "检测到页面已切换，解除导航锁", { from: runtime.navigateFrom, url: location.href });
				runtime.navigating = false;
			} else if (Date.now() - runtime.navigateAt > NAVIGATE_TIMEOUT_MS) {
				vlog("block", "导航超过 15 秒仍未落地，解除导航锁并重新计时（可能被站点拦截）", { to: runtime.navigateTo }, "error");
				runtime.navigating = false;
				runtime.pageEnterAt = Date.now();
				runtime.skipReason = "";
				runtime.noVideoDelayMs = 0;
			} else {
				vlog("guard", "等待上一次导航落地，本轮跳过所有自动动作", { to: runtime.navigateTo, sinceSec: Math.round((Date.now() - runtime.navigateAt) / 1000) });
				return;
			}
		}
		// v3.4.8：验证码只读状态机 + 单标签页租约续约（都不修改页面）
		try { updateCaptchaState(); } catch (e) {}
		var leaseInfo = renewSwitchLease();
		runtime.busy = true;
		runtime.loopSeq++;
		vlog("guard", "单标签页切换锁续约结果", leaseInfo || { disabled: true });
		vlog("loop", "第 " + runtime.loopSeq + " 轮循环开始", { url: location.href, dwellSec: Math.round((Date.now() - runtime.pageEnterAt) / 1000), skipReason: runtime.skipReason, videoKey: runtime.videoKey, catalogFp: runtime.catalogFp.slice(0, 80) });
		try {
			if (runtime.url !== location.href) {
				var prevUrl = runtime.url;
				runtime.url = location.href;
				runtime.quizSignature = "";
				runtime.lastAdvance = 0;
				runtime.pageEnterAt = Date.now();
				runtime.videoEndedAt = 0;
				runtime.finishedVideoKey = "";
				runtime.switchDelayMs = 0;
				runtime.noVideoDelayMs = 0;
				runtime.skipReason = "";
				runtime.boundaryLogged = false;
				runtime.playAttemptKey = "";
				runtime.playAttemptFailed = false;
				runtime.playAttemptBlocked = false;
				runtime.playWatchSince = 0;
				runtime.navigating = false;
				vlog("navigate", "检测到 URL 变化（新页面 / 原地换节），重置本节全部 runtime 状态", { previous: prevUrl, current: location.href, lastJumpAgeSec: Math.round((Date.now() - lastJumpAt()) / 1000), targetValid: targetValid() });
				var landing = checkNavigationLanding();
				vlog("navigate", "导航落点校验", landing);
				setTimeout(expandCollapsedGroups, 800);
			}
			var mode = detectMode();
			var cfg = getConfig();
			vlog("loop", "本轮页面模式 = " + mode, {
				mode: mode,
				config: { enabled: cfg.enabled, autoJump: cfg.autoJump, autoVideo: cfg.autoVideo, skipOnFail: cfg.skipOnFail, autoNextChapter: cfg.autoNextChapter, autoAnswer: cfg.autoAnswer, verboseLog: cfg.verboseLog, singleTabLock: cfg.singleTabLock, autoCloseDialogs: cfg.autoCloseDialogs, captchaMode: captchaMode(), switchDelaySec: cfg.switchDelayMinSec + "~" + cfg.switchDelayMaxSec }
			});
			ensureUi(mode === "idle" ? "settings" : "task");
			var config = getConfig();
			if (!config.enabled) {
				if (ui.ask) ui.ask.msg("助手已手动关闭，所有自动任务均已停止");
				vlog("block", "本轮不做任何事：面板总开关关闭", { mode: mode }, "error");
				return;
			}
			if (mode === "study") {
				await videoStep();
			} else if (mode === "quiz") {
				if (config.autoAnswer) await quizStep();
			} else if (ui.ask) ui.ask.msg("当前页面暂无任务");
		} catch (e) {
			log(e, "error");
			vlog("error", "运行异常：" + (e && e.message ? e.message : e), { stack: e && e.stack ? String(e.stack).slice(0, 500) : "" }, "error");
			if (ui.ask) ui.ask.log("运行异常：" + (e && e.message ? e.message : e), "error");
		} finally {
			runtime.busy = false;
			vlog("loop", "第 " + runtime.loopSeq + " 轮循环结束", { url: location.href, navigating: runtime.navigating, skipReason: runtime.skipReason });
		}
	}
	function loop() {
		if (isStopped()) return;
		step().finally(() => {
			if (isStopped()) return;
			var delay = Math.max(1, Number(getConfig().interval) || 3) * 1e3;
			runtime.timer = setTimeout(loop, delay);
		});
	}

	/* ---------------- 6.6 启动 ---------------- */
	var marker = "data-manfen-initialized";
	function boot() {
		if (document.documentElement.hasAttribute(marker)) return;
		document.documentElement.setAttribute(marker, SCRIPT_VERSION);
		var cfgBoot = getConfig();
		vlog("boot", "脚本启动 v" + SCRIPT_VERSION + "（" + location.host + "）", {
			version: SCRIPT_VERSION, url: location.href, userAgent: navigator.userAgent ? String(navigator.userAgent).slice(0, 160) : "",
			config: { enabled: cfgBoot.enabled, autoJump: cfgBoot.autoJump, autoVideo: cfgBoot.autoVideo, skipOnFail: cfgBoot.skipOnFail, autoNextChapter: cfgBoot.autoNextChapter, autoAnswer: cfgBoot.autoAnswer, verboseLog: cfgBoot.verboseLog, singleTabLock: cfgBoot.singleTabLock, autoCloseDialogs: cfgBoot.autoCloseDialogs, interval: cfgBoot.interval, switchDelaySec: cfgBoot.switchDelayMinSec + "~" + cfgBoot.switchDelayMaxSec },
			catalog: catalogSummary(), stopRecord: readStopRecord()
		}, "success");
		allowCopy();
		installResumeCommand();
		// v3.4.8：验证码完全由本人填写，助手不安装任何页面钩子，只做只读检测
		installCaptchaGuard();
		// 停止状态下也要能查「学时为什么没涨」
		try {
			pageWindow.__mfStudy = () => studyHealth();
			pageWindow.__mfLogs = (n) => mfLogEntries(n);
			pageWindow.__mfLogText = (n) => mfLogText(n);
			pageWindow.__mfLogClear = () => mfLogClear();
			pageWindow.__mfLogDownload = () => {
				var text = "拓知助手 v" + SCRIPT_VERSION + " 详细运行日志\n导出时间：" + new Date().toLocaleString() + "\n共 " + mfLogEntries().length + " 条\n\n" + mfLogText();
				var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
				var url = URL.createObjectURL(blob);
				var a = document.createElement("a");
				a.href = url;
				a.download = "tuozhi-mf-log-" + Date.now() + ".txt";
				document.body.appendChild(a);
				a.click();
				setTimeout(() => { try { a.remove(); URL.revokeObjectURL(url); } catch (e) {} }, 1000);
				return text.length;
			};
			// 手动清除「验证后观察宽限」；绝不碰弹窗本身
			pageWindow.__mfCaptchaClear = () => {
				captchaGuard.lastSeenAt = 0;
				captchaGuard.episodeStartAt = 0;
				captchaGuard.wasPresent = false;
				vlog("captcha", "手动清除验证码观察宽限（不影响弹窗本身）", {});
				return { cleared: true, inGrace: inCaptchaGrace() };
			};
		} catch (e) {}
		// 切小节是整页刷新：用户手动停止过，新页面必须保持停止，绝不能自动跑起来
		var stopRecord = readStopRecord();
		// v3.4.0 起不再自动停止；旧版本写下的「自动熔断」记录一律清掉，避免升级后被卡住
		var clearedLegacyStop = false;
		if (stopRecord && stopRecord.reason !== "手动停止") {
			try { pageWindow.sessionStorage.removeItem(STOP_KEY); } catch (e) {}
			stopRecord = null;
			clearedLegacyStop = true;
		}
		if (stopRecord) {
			safety.stopped = true;
			safety.reason = stopRecord.reason || "助手已手动停止";
			safety.detail = stopRecord.detail || "";
			ensureUi(detectMode() === "idle" ? "settings" : "task");
			if (ui.ask) {
				ui.ask.log("脚本 v" + SCRIPT_VERSION + " 已加载，但处于停止状态", "error");
				ui.ask.log("上次停止原因：" + safety.reason + " " + safety.detail + "（" + (stopRecord.url || "") + "）", "error");
				ui.ask.msg("⛔ 已停止：" + safety.reason);
			}
			showStopBanner();
			return;
		}
		// v3.4.4：清掉旧版本残留的「上次切换目标」。旧版没有时效校验，
		// 用户隔很久回到某章作业时会被这个陈旧值锚到别的章节，造成跨章乱跳。
		var clearedStaleTarget = false;
		if (lastTargetId() && !targetValid()) {
			clearStaleTarget();
			clearedStaleTarget = true;
		}
		// 首屏就按当前页面决定面板形态，避免先挂设置面板再重挂一次造成闪烁
		ensureUi(detectMode() === "idle" ? "settings" : "task");
		if (ui.ask) {
			var summary = catalogSummary();
			ui.ask.log("脚本已加载 v" + SCRIPT_VERSION + "：" + location.host, "success");
			ui.ask.log("目录识别：" + summary.groups + " 个大章节 / " + summary.leaves + " 个小章节（大章节标题已排除），当前 nodeId=" + (summary.current || "未知") + "，章末进入下一章=" + (getConfig().autoNextChapter === false ? "关" : "开"), summary.leaves > 1 ? "success" : "error");
			if (summary.bareGroups) ui.ask.log("另有 " + summary.bareGroups + " 个纯大章节（无小章节列表），已按设置忽略，不会切换过去", "success");
			if (clearedLegacyStop) ui.ask.log("已清除旧版本的自动停止记录：新版本播放失败只跳下一节，不再停止脚本", "success");
			if (clearedStaleTarget) ui.ask.log("已清除过期残留的「上次切换目标」，本页只按目录顺序定位，不会再跨章乱跳", "success");
			ui.ask.log("切换规则：一次只切目录里紧挨着的 1 个小节，最多从章末进下一章第 1 节；不再按 nodeId 数值找后继", "success");
			ui.ask.log("验证码=本人填写、助手只读旁观：不 hook layer.open、不关闭弹窗、不吞平台暂停、不代填、不伪造学时请求；弹窗出现时助手暂停自动动作，您填完点「开始播放」后平台自行恢复播放，助手自动接着学", "success");
			ui.ask.log("旧面板里保存的「忽略验证码 / 验证码协作 / 仅忽略弹窗」配置已全部停用，避免升级后又把学时弄成 0", "success");
			ui.ask.log("学时自检：控制台执行 __mfStudy() 查看学时为何没涨（验证码 / 后台节流 / 多开视频页 / 暂停）", "success");
			ui.ask.log("详细日志=" + (getConfig().verboseLog === false ? "关" : "开") + "：控制台全量输出 + 跨页保留最近 " + LOG_MAX + " 条；__mfLogText() 导出全文 / __mfLogDownload() 下载 / __mfLogs() 看结构化数组 / __mfLogClear() 清空", "success");
			ui.ask.log("v3.4.8 防乱跳：验证码期间不判失败/不切节 + 绝不点击大章节标题 + 单标签页切换锁 + 导航落点校验 + 目录指纹稳定 3 秒 + 导航锁 + 目标时效 25 秒", "success");
			ui.ask.msg("等待任务");
		}
		// 控制台自检：__mfCatalog() 看小节顺序，__mfDiag() 看「为什么没切」
		try {
			pageWindow.__mfCatalog = () => catalog().map((e, i) => ({
				seq: i + 1,
				type: "小章节",
				nodeId: e.nodeId,
				groupIndex: e.groupIndex + 1,
				group: e.groupTitle,
				text: e.text,
				visible: e.visible,
				locked: e.locked,
				href: e.href
			}));
			pageWindow.__mfDiag = () => {
				var c = getConfig();
				var list = catalog();
				var loc = locateCurrent(list);
				var index = loc.index;
				var info = (e) => e ? { nodeId: e.nodeId, groupIndex: e.groupIndex + 1, group: e.groupTitle, text: e.text, locked: e.locked } : null;
				var curSection = index >= 0 ? list[index] : null;
				var nextSection = index >= 0 ? list[index + 1] : null;
				var jumpAt = lastJumpAt();
				var targetAge = targetAgeMs();
				var rule = "未定位到当前节：不会切换（不按 nodeId 猜位置）";
				if (curSection && nextSection) {
					if (nextSection.locked) rule = "阻止：紧邻下一节被锁定";
					else if (curSection.groupIndex >= 0 && nextSection.groupIndex >= 0 && (nextSection.groupIndex < curSection.groupIndex || nextSection.groupIndex > curSection.groupIndex + 1)) rule = "阻止：紧邻项跨了多个大章节";
					else if (c.autoNextChapter === false && nextSection.groupIndex > curSection.groupIndex) rule = "阻止：面板关闭了「章末进入下一章」";
					else rule = "允许：只切紧邻的 1 个小节";
				} else if (curSection) rule = "已到最后一小节";
				return {
					version: SCRIPT_VERSION,
					url: location.href,
					currentNodeId: loc.current,
					locateBy: loc.how,
					currentIndex: index >= 0 ? index + 1 : -1,
					currentSection: info(curSection),
					nextSection: info(nextSection),
					nextJumpRule: rule,
					sections: list.length,
					summary: catalogSummary(),
					lastTarget: { nodeId: lastTargetId(), ageSec: Number.isFinite(targetAge) ? Math.round(targetAge / 1000) : -1, valid: targetValid() },
					config: { enabled: c.enabled, autoJump: c.autoJump, skipOnFail: c.skipOnFail, autoNextChapter: c.autoNextChapter, verboseLog: c.verboseLog, singleTabLock: c.singleTabLock, autoCloseDialogs: c.autoCloseDialogs, switchDelayMinSec: c.switchDelayMinSec, switchDelayMaxSec: c.switchDelayMaxSec },
					captcha: studyHealth(),
					lease: { enabled: switchLockEnabled(), owner: (readLease() || {}).id || null, self: (readLease() || {}).id === tabIdentity() },
					logging: { verbose: logVerboseEnabled(), entries: mfLogEntries().length, max: LOG_MAX, key: LOG_KEY, hint: "__mfLogText() 导出全文 / __mfLogDownload() 下载 / __mfLogClear() 清空" },
					runtime: {
						skipReason: runtime.skipReason,
						dwellSec: Math.round((Date.now() - runtime.pageEnterAt) / 1000),
						waitSec: Math.round(noVideoDelayMs() / 1000),
						coolDownSec: Math.max(0, Math.round((8e3 - (Date.now() - lastJumpAt())) / 1000)),
						navigating: runtime.navigating,
						navigateTo: runtime.navigateTo,
						catalogStableSec: Math.round((Date.now() - runtime.catalogFpSince) / 1000),
						catalogNeedsSec: CATALOG_STABLE_MS / 1000,
						loopSeq: runtime.loopSeq,
						stopped: isStopped()
					}
				};
			};
			// 只读排查：绝不关弹窗（关掉就等于把本人输入验证码的入口毁了）
			pageWindow.__mfCaptcha = () => Object.assign({
				version: SCRIPT_VERSION,
				mode: captchaMode(),
				seenTotal: captchaGuard.seenTotal,
				inGrace: inCaptchaGrace(),
				lastSeenSecAgo: captchaGuard.lastSeenAt ? Math.round((Date.now() - captchaGuard.lastSeenAt) / 1000) : -1
			}, studyHealth());
		} catch (e) {}
		setTimeout(expandCollapsedGroups, 1200);
		try { pageWindow.addEventListener("pagehide", releaseSwitchLease); } catch (e) {}
		loop();
	}
	if (document.body) boot();
	else document.addEventListener("DOMContentLoaded", boot, { once: true });
})(typeof Vue !== "undefined" ? Vue : window.Vue, typeof Pinia !== "undefined" ? Pinia : window.Pinia);
