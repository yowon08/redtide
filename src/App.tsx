// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Point = { x: number; y: number };
type LineStyle = "solid" | "arrow" | "dashed";

type Token = {
  id: number;
  name: string;
  x: number;
  y: number;
  color: string;
  note: string;
  sizeScale?: number;
  customImage?: string | null;
};

type LineItem = {
  id: number;
  name: string;
  color: string;
  points: Point[];
  style: LineStyle;
  sizeScale?: number;
};

type LabelItem = {
  id: number;
  text: string;
  x: number;
  y: number;
  color: string;
};

type ViewerData = {
  title?: string;
  background?: string;
  tokens?: Token[];
  lines?: LineItem[];
  labels?: LabelItem[];
  notes?: string;
};

type ArrowHead = {
  tip: Point;
  left: Point;
  right: Point;
};

const DEFAULT_BG = "/new-sandiego-map.png";
const NATURAL_WIDTH = 1365;
const NATURAL_HEIGHT = 768;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3.5;
const MOBILE_BREAKPOINT = 900;

function clampZoom(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function clampMarkerScale(value: number) {
  return Math.max(0.35, Math.min(1.4, value));
}

function clampLineScale(value: number) {
  return Math.max(0.35, Math.min(1.6, value));
}

function makePath(points: Point[]) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

function getContrastingTextColor(bg: string) {
  return bg?.toLowerCase() === "#ffffff" ? "#111111" : "#ffffff";
}

function getArrowHead(start: Point, end: Point, size = 7): ArrowHead | null {
  if (start.x === end.x && start.y === end.y) return null;

  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  return {
    tip: end,
    left: {
      x: end.x - size * Math.cos(angle - Math.PI / 6),
      y: end.y - size * Math.sin(angle - Math.PI / 6),
    },
    right: {
      x: end.x - size * Math.cos(angle + Math.PI / 6),
      y: end.y - size * Math.sin(angle + Math.PI / 6),
    },
  };
}

function getRepeatedArrowHeads(points: Point[], spacing = 30, size = 7) {
  const arrows: ArrowHead[] = [];

  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < spacing * 0.75) continue;

    const ux = dx / length;
    const uy = dy / length;
    const count = Math.max(1, Math.floor(length / spacing));

    for (let j = 1; j <= count; j += 1) {
      const dist = Math.min(j * spacing, length - 2);
      if (dist <= 5) continue;

      const tip = { x: start.x + ux * dist, y: start.y + uy * dist };
      const tail = {
        x: tip.x - ux * size * 1.8,
        y: tip.y - uy * size * 1.8,
      };
      const arrow = getArrowHead(tail, tip, size);
      if (arrow) arrows.push(arrow);
    }
  }

  return arrows;
}

function renderArrowMarkers(
  points: Point[],
  color: string,
  keyPrefix: string,
  sizeScale = 1
) {
  const spacing = 24 * sizeScale;
  const arrowSize = 10 * sizeScale;
  const stroke = Math.max(1.2, 2.4 * sizeScale);

  return getRepeatedArrowHeads(points, spacing, arrowSize).map((arrow, index) => (
    <g key={`${keyPrefix}-${index}`}>
      <line
        x1={arrow.left.x}
        y1={arrow.left.y}
        x2={arrow.tip.x}
        y2={arrow.tip.y}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      <line
        x1={arrow.right.x}
        y1={arrow.right.y}
        x2={arrow.tip.x}
        y2={arrow.tip.y}
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </g>
  ));
}

function getTouchDistance(t1: Touch, t2: Touch) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function getTouchCenter(t1: Touch, t2: Touch) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  };
}

function buttonStyle(): React.CSSProperties {
  return {
    width: 50,
    height: 50,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(15,23,42,0.88)",
    color: "#fff",
    fontSize: 22,
    cursor: "pointer",
    backdropFilter: "blur(10px)",
  };
}

export default function App() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const didSetInitialViewRef = useRef(false);

  const touchModeRef = useRef<"none" | "pan" | "pinch">("none");
  const touchStartRef = useRef({
    distance: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    centerX: 0,
    centerY: 0,
    mapX: 0,
    mapY: 0,
  });

  const [title, setTitle] = useState("전술지도");
  const [background, setBackground] = useState(DEFAULT_BG);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [notes, setNotes] = useState("");

  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");

  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null);

  const totalScale = baseScale * zoom;
  const isMobileLayout =
    typeof window !== "undefined" ? window.innerWidth <= MOBILE_BREAKPOINT : false;

  useEffect(() => {
    let cancelled = false;

    async function loadJson() {
      try {
        setLoading(true);
        setErrorText("");

        const res = await fetch("/map-data.json", { cache: "no-store" });
        if (!res.ok) {
          throw new Error("public/map-data.json 파일을 불러오지 못했습니다.");
        }

        const data: ViewerData = await res.json();
        if (cancelled) return;

        setTitle(data.title || "전술지도");
        setBackground(data.background || DEFAULT_BG);
        setTokens(
          Array.isArray(data.tokens)
            ? data.tokens.map((token) => ({
                ...token,
                sizeScale: clampMarkerScale(token.sizeScale ?? 1),
                customImage: token.customImage ?? null,
                note: token.note ?? "",
              }))
            : []
        );
        setLines(
          Array.isArray(data.lines)
            ? data.lines.map((line) => ({
                ...line,
                sizeScale: clampLineScale(line.sizeScale ?? 1),
              }))
            : []
        );
        setLabels(Array.isArray(data.labels) ? data.labels : []);
        setNotes(data.notes || "");
      } catch (err: any) {
        if (!cancelled) {
          setErrorText(err?.message || "지도 데이터를 불러오는 중 오류가 발생했습니다.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadJson();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedToken = useMemo(
    () => tokens.find((token) => token.id === selectedTokenId) ?? null,
    [tokens, selectedTokenId]
  );

  const updateBaseScale = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const fitted = Math.min(
      frame.clientWidth / NATURAL_WIDTH,
      frame.clientHeight / NATURAL_HEIGHT
    );

    setBaseScale(fitted || 1);
  }, []);

  const clampPanForScale = useCallback(
    (nextPanX: number, nextPanY: number, nextZoom = zoom) => {
      const frame = frameRef.current;
      if (!frame) return { x: nextPanX, y: nextPanY };

      const nextTotalScale = baseScale * nextZoom;
      const scaledWidth = NATURAL_WIDTH * nextTotalScale;
      const scaledHeight = NATURAL_HEIGHT * nextTotalScale;

      let minPanX = frame.clientWidth - scaledWidth;
      let minPanY = frame.clientHeight - scaledHeight;

      if (minPanX > 0) minPanX = (frame.clientWidth - scaledWidth) / 2;
      if (minPanY > 0) minPanY = (frame.clientHeight - scaledHeight) / 2;

      const maxPanX = minPanX > 0 ? minPanX : 0;
      const maxPanY = minPanY > 0 ? minPanY : 0;

      return {
        x: Math.min(maxPanX, Math.max(minPanX, nextPanX)),
        y: Math.min(maxPanY, Math.max(minPanY, nextPanY)),
      };
    },
    [baseScale, zoom]
  );

  const fitWholeMap = useCallback(
    (nextZoom = 1) => {
      const frame = frameRef.current;
      if (!frame) return;

      const nextTotalScale = baseScale * nextZoom;
      const scaledWidth = NATURAL_WIDTH * nextTotalScale;
      const scaledHeight = NATURAL_HEIGHT * nextTotalScale;

      setZoom(nextZoom);
      setPan({
        x: (frame.clientWidth - scaledWidth) / 2,
        y: (frame.clientHeight - scaledHeight) / 2,
      });
    },
    [baseScale]
  );

  useEffect(() => {
    const run = () => updateBaseScale();
    run();
    window.addEventListener("resize", run);
    return () => window.removeEventListener("resize", run);
  }, [updateBaseScale]);

  useEffect(() => {
    if (baseScale <= 0) return;

    if (!didSetInitialViewRef.current) {
      didSetInitialViewRef.current = true;
      requestAnimationFrame(() => fitWholeMap(1));
      return;
    }

    setPan((prev) => clampPanForScale(prev.x, prev.y, zoom));
  }, [baseScale, clampPanForScale, fitWholeMap, zoom]);

  const zoomAtClientPoint = useCallback(
    (nextZoomRaw: number, clientX: number, clientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const nextZoom = clampZoom(nextZoomRaw);
      const rect = viewport.getBoundingClientRect();

      const mapX = (clientX - rect.left - pan.x) / totalScale;
      const mapY = (clientY - rect.top - pan.y) / totalScale;

      const nextTotalScale = baseScale * nextZoom;
      const nextPanX = clientX - rect.left - mapX * nextTotalScale;
      const nextPanY = clientY - rect.top - mapY * nextTotalScale;

      const clamped = clampPanForScale(nextPanX, nextPanY, nextZoom);
      setZoom(nextZoom);
      setPan(clamped);
    },
    [baseScale, clampPanForScale, pan.x, pan.y, totalScale]
  );

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0012;
    zoomAtClientPoint(zoom + delta, e.clientX, e.clientY);
  };

  const startPan = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const clickedToken = Boolean(target.closest("[data-map-token='true']"));
    if (clickedToken) return;

    setSelectedTokenId(null);
    setIsPanning(true);
    setPanStart({
      x: e.clientX - pan.x,
      y: e.clientY - pan.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning) return;
    const next = clampPanForScale(e.clientX - panStart.x, e.clientY - panStart.y, zoom);
    setPan(next);
  };

  const endPointerAction = () => {
    setIsPanning(false);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const center = getTouchCenter(t1, t2);
      const viewport = viewportRef.current;
      if (!viewport) return;

      const rect = viewport.getBoundingClientRect();
      const mapX = (center.x - rect.left - pan.x) / totalScale;
      const mapY = (center.y - rect.top - pan.y) / totalScale;

      touchModeRef.current = "pinch";
      touchStartRef.current = {
        distance: getTouchDistance(t1, t2),
        zoom,
        panX: pan.x,
        panY: pan.y,
        centerX: center.x,
        centerY: center.y,
        mapX,
        mapY,
      };
      return;
    }

    if (e.touches.length === 1) {
      const target = e.target as HTMLElement;
      const clickedToken = Boolean(target.closest("[data-map-token='true']"));
      if (clickedToken) return;

      const t = e.touches[0];
      touchModeRef.current = "pan";
      setIsPanning(true);
      setPanStart({
        x: t.clientX - pan.x,
        y: t.clientY - pan.y,
      });
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchModeRef.current === "pinch" && e.touches.length === 2) {
      e.preventDefault();

      const [t1, t2] = [e.touches[0], e.touches[1]];
      const currentDistance = getTouchDistance(t1, t2);
      const center = getTouchCenter(t1, t2);

      const ratio = currentDistance / Math.max(1, touchStartRef.current.distance);
      const nextZoom = clampZoom(touchStartRef.current.zoom * ratio);
      const nextTotalScale = baseScale * nextZoom;

      const viewport = viewportRef.current;
      if (!viewport) return;

      const rect = viewport.getBoundingClientRect();
      const nextPanX = center.x - rect.left - touchStartRef.current.mapX * nextTotalScale;
      const nextPanY = center.y - rect.top - touchStartRef.current.mapY * nextTotalScale;

      const clamped = clampPanForScale(nextPanX, nextPanY, nextZoom);
      setZoom(nextZoom);
      setPan(clamped);
      return;
    }

    if (touchModeRef.current === "pan" && e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      const next = clampPanForScale(t.clientX - panStart.x, t.clientY - panStart.y, zoom);
      setPan(next);
    }
  };

  const handleTouchEnd = () => {
    touchModeRef.current = "none";
    setIsPanning(false);
  };

  const changeZoomByButton = (delta: number) => {
    const frame = frameRef.current;
    if (!frame) return;

    const rect = frame.getBoundingClientRect();
    zoomAtClientPoint(zoom + delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#000",
        color: "#fff",
        fontFamily: "Arial, sans-serif",
        position: "relative",
      }}
    >
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            fontSize: 18,
          }}
        >
          지도 불러오는 중...
        </div>
      )}

      {!loading && errorText && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            fontSize: 16,
            padding: 24,
            textAlign: "center",
            whiteSpace: "pre-wrap",
            lineHeight: 1.6,
          }}
        >
          {errorText}
        </div>
      )}

      {!loading && !errorText && (
        <>
          <div
            style={{
              position: "absolute",
              top: 14,
              left: 14,
              right: 14,
              zIndex: 30,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                background: "rgba(10,10,10,0.6)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 18,
                padding: "12px 14px",
                backdropFilter: "blur(8px)",
                maxWidth: isMobileLayout ? "72%" : "420px",
                pointerEvents: "auto",
              }}
            >
              <div style={{ fontSize: isMobileLayout ? 18 : 22, fontWeight: 800 }}>
                {title}
              </div>
              {notes?.trim() ? (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 13,
                    color: "rgba(255,255,255,0.82)",
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {notes}
                </div>
              ) : null}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                pointerEvents: "auto",
              }}
            >
              <button onClick={() => fitWholeMap(1)} style={buttonStyle()} title="전체 보기">
                ⛶
              </button>
              <button onClick={() => changeZoomByButton(0.2)} style={buttonStyle()} title="확대">
                +
              </button>
              <button onClick={() => changeZoomByButton(-0.2)} style={buttonStyle()} title="축소">
                −
              </button>
            </div>
          </div>

          <div
            ref={frameRef}
            style={{
              position: "absolute",
              inset: 0,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <div
              ref={viewportRef}
              style={{
                position: "absolute",
                inset: 0,
                cursor: isPanning ? "grabbing" : "grab",
                touchAction: "none",
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
              onMouseDown={startPan}
              onMouseMove={handleMouseMove}
              onMouseUp={endPointerAction}
              onMouseLeave={endPointerAction}
              onWheel={handleWheel}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onClick={() => setSelectedTokenId(null)}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: NATURAL_WIDTH,
                  height: NATURAL_HEIGHT,
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${totalScale})`,
                  transformOrigin: "top left",
                }}
              >
                <img
                  src={background || DEFAULT_BG}
                  alt="전술지도 배경"
                  draggable={false}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "fill",
                    pointerEvents: "none",
                  }}
                />

                <svg
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                  }}
                  viewBox={`0 0 ${NATURAL_WIDTH} ${NATURAL_HEIGHT}`}
                >
                  {lines.map((line) => {
                    const linePath = makePath(line.points);
                    const lineScale = clampLineScale(line.sizeScale ?? 1);
                    const baseStroke = line.style === "arrow" ? 3.5 : 5;
                    const strokeWidth = Math.max(1.4, baseStroke * lineScale);
                    const dashArray =
                      line.style === "dashed"
                        ? `${10 * lineScale} ${8 * lineScale}`
                        : undefined;

                    return (
                      <g key={line.id}>
                        <path
                          d={linePath}
                          fill="none"
                          stroke={line.color}
                          strokeWidth={strokeWidth}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeDasharray={dashArray}
                        />
                        {line.style === "arrow"
                          ? renderArrowMarkers(
                              line.points,
                              line.color,
                              `${line.id}-arrow`,
                              lineScale
                            )
                          : null}
                      </g>
                    );
                  })}
                </svg>

                {labels.map((label) => (
                  <div
                    key={label.id}
                    style={{
                      position: "absolute",
                      left: label.x,
                      top: label.y,
                      transform: "translate(-50%, -50%)",
                      color: "#ffffff",
                      background: "rgba(10,10,10,0.6)",
                      padding: "4px 8px",
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 700,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.28)",
                      pointerEvents: "none",
                    }}
                  >
                    {label.text}
                  </div>
                ))}

                {tokens.map((token) => {
                  const isSelected = selectedTokenId === token.id;
                  const markerScale = clampMarkerScale(token.sizeScale ?? 1);

                  return (
                    <div
                      key={token.id}
                      data-map-token="true"
                      style={{
                        position: "absolute",
                        left: token.x,
                        top: token.y,
                        transform: "translate(-50%, -100%)",
                        pointerEvents: "auto",
                        zIndex: isSelected ? 200 : 20,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTokenId((prev) => (prev === token.id ? null : token.id));
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 4 * markerScale,
                          position: "relative",
                          cursor: "pointer",
                        }}
                      >
                        {token.customImage ? (
                          <>
                            <div
                              style={{
                                padding: `${4 * markerScale}px ${8 * markerScale}px`,
                                borderRadius: 999,
                                border: `${Math.max(1.5, 2 * markerScale)}px solid ${
                                  isSelected ? "#ffffff" : "#09090b"
                                }`,
                                background: "rgba(10,10,10,0.88)",
                                boxShadow: "0 10px 20px rgba(0,0,0,0.35)",
                              }}
                            >
                              <img
                                src={token.customImage}
                                alt={token.name}
                                draggable={false}
                                style={{
                                  width: 40 * markerScale,
                                  height: 40 * markerScale,
                                  objectFit: "contain",
                                  display: "block",
                                  pointerEvents: "none",
                                }}
                              />
                            </div>

                            <div
                              style={{
                                borderRadius: 999,
                                border: `${Math.max(1.5, 2 * markerScale)}px solid ${
                                  isSelected ? "#ffffff" : "#09090b"
                                }`,
                                padding: `${3 * markerScale}px ${10 * markerScale}px`,
                                fontSize: 11 * markerScale,
                                fontWeight: 700,
                                background: token.color,
                                color: getContrastingTextColor(token.color),
                                boxShadow: "0 8px 16px rgba(0,0,0,0.28)",
                                whiteSpace: "nowrap",
                                lineHeight: 1.1,
                              }}
                            >
                              {token.name}
                            </div>
                          </>
                        ) : (
                          <>
                            <div
                              style={{
                                borderRadius: 999,
                                border: `${Math.max(1.5, 2 * markerScale)}px solid ${
                                  isSelected ? "#ffffff" : "#09090b"
                                }`,
                                padding: `${4 * markerScale}px ${12 * markerScale}px`,
                                fontSize: 12 * markerScale,
                                fontWeight: 700,
                                background: token.color,
                                color: getContrastingTextColor(token.color),
                                boxShadow: "0 10px 20px rgba(0,0,0,0.35)",
                                whiteSpace: "nowrap",
                                lineHeight: 1.1,
                              }}
                            >
                              {token.name}
                            </div>

                            <div
                              style={{
                                width: 16 * markerScale,
                                height: 16 * markerScale,
                                transform: "rotate(45deg)",
                                border: `${Math.max(1.5, 2 * markerScale)}px solid ${
                                  isSelected ? "#ffffff" : "#09090b"
                                }`,
                                background: token.color,
                              }}
                            />
                          </>
                        )}

                        {isSelected && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: "absolute",
                              left: `${48 * markerScale}px`,
                              top: `${8 * markerScale}px`,
                              minWidth: `${220 * markerScale}px`,
                              maxWidth: `${280 * markerScale}px`,
                              padding: `${12 * markerScale}px`,
                              borderRadius: `${14 * markerScale}px`,
                              border: "1px solid rgba(255,255,255,0.16)",
                              background: "rgba(10,10,10,0.94)",
                              color: "#ffffff",
                              boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
                              backdropFilter: "blur(6px)",
                              zIndex: 210,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 8 * markerScale,
                                marginBottom: 6 * markerScale,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 13 * markerScale,
                                  fontWeight: 800,
                                  color: token.color,
                                  lineHeight: 1.2,
                                  paddingRight: 8 * markerScale,
                                }}
                              >
                                {token.name}
                              </div>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTokenId(null);
                                }}
                                style={{
                                  width: 24 * markerScale,
                                  height: 24 * markerScale,
                                  borderRadius: 999,
                                  border: "1px solid rgba(255,255,255,0.14)",
                                  background: "rgba(255,255,255,0.06)",
                                  color: "#ffffff",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: "pointer",
                                  padding: 0,
                                  fontSize: 12 * markerScale,
                                  flex: "0 0 auto",
                                }}
                                aria-label="팝업 닫기"
                              >
                                ×
                              </button>
                            </div>

                            <div
                              style={{
                                fontSize: 11 * markerScale,
                                lineHeight: 1.45,
                                color: "#e4e4e7",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {token.note?.trim() ? token.note : "등록된 정보가 없습니다."}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}