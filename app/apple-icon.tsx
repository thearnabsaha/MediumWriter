import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #1a8917 0%, #0f5d10 55%, #0a0a0a 100%)",
          borderRadius: 36,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 60%)",
          }}
        />
        <div
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 118,
            fontWeight: 700,
            color: "#ffffff",
            letterSpacing: -5,
            lineHeight: 1,
            marginTop: -6,
          }}
        >
          M
        </div>
        <div
          style={{
            position: "absolute",
            top: 30,
            right: 28,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#1a8917",
            border: "3px solid #ffffff",
          }}
        />
      </div>
    ),
    {
      ...size,
    },
  );
}
