import {
  AbsoluteFill,
  CanvasImage,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import "./fonts";

type FeatureProps = {
  title: string;
  caption: string;
  shot: string;
  chapter: string;
  dark?: boolean;
  offset?: number;
};
const Shot = ({ shot, offset = 0 }: { shot: string; offset?: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        left: 130,
        top: 285,
        width: 1660,
        height: 640,
        borderRadius: 30,
        overflow: "hidden",
        border: "3px solid rgba(255,255,255,.65)",
        boxShadow: "0 28px 90px rgba(75,37,69,.16)",
      }}
    >
      <CanvasImage
        name="Настоящий скриншот лаунчера"
        src={staticFile(`screenshots/${shot}`)}
        width={1660}
        height={1061}
        style={{
          position: "absolute",
          top: offset,
          width: 1660,
          height: 1061,
          scale: interpolate(frame, [0, 6 * fps], [1, 1.025], {
            extrapolateRight: "clamp",
          }),
          transformOrigin: "50% 30%",
        }}
      />
    </div>
  );
};
const Feature = ({
  title,
  caption,
  shot,
  chapter,
  dark = false,
  offset = 0,
}: FeatureProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        background: dark
          ? "radial-gradient(ellipse at 80% 5%,#242044,#0b0e1f 70%)"
          : "radial-gradient(ellipse at 10% 0%,#f8cde0,#fdeef4 75%)",
        color: dark ? "#eeeaff" : "#4d3042",
        fontFamily: "Nunito, sans-serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 130,
          top: 58,
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <CanvasImage src={staticFile("logo.png")} width={55} height={55} />
        <span
          style={{
            fontFamily: "Fredoka, sans-serif",
            fontSize: 38,
            fontWeight: 600,
          }}
        >
          Femboy{" "}
          <span
            style={{
              fontFamily: "Nunito, sans-serif",
              fontSize: 30,
              fontWeight: 600,
            }}
          >
            launcher
          </span>
        </span>
      </div>
      <span
        style={{
          position: "absolute",
          right: 130,
          top: 71,
          fontSize: 25,
          fontWeight: 800,
          letterSpacing: 3,
          color: dark ? "#c6bdff" : "#ae3972",
        }}
      >
        ОБЗОР · {chapter}
      </span>
      <Interactive.H1
        name="Заголовок сцены"
        style={{
          position: "absolute",
          left: 130,
          top: 149,
          margin: 0,
          fontFamily: "Comfortaa, sans-serif",
          fontSize: 84,
          lineHeight: 1.1,
          fontWeight: 700,
          opacity: interpolate(frame, [0, 0.35 * fps], [0, 1], {
            extrapolateRight: "clamp",
          }),
          translate: `0 ${interpolate(frame, [0, 0.4 * fps], [18, 0], { extrapolateRight: "clamp" })}px`,
        }}
      >
        {title}
      </Interactive.H1>
      <Shot shot={shot} offset={offset} />
      <Interactive.P
        name="Подпись сцены"
        style={{
          position: "absolute",
          left: 130,
          right: 130,
          bottom: 72,
          margin: 0,
          fontSize: 38,
          lineHeight: 1.25,
          fontWeight: 700,
          color: dark ? "#ccc6ef" : "#85566f",
        }}
      >
        {caption}
      </Interactive.P>
    </AbsoluteFill>
  );
};
const Closing = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(ellipse at 50% 30%,#f7c9df,#fdeef4 70%)",
        color: "#4d3042",
        fontFamily: "Nunito, sans-serif",
        alignItems: "center",
        justifyContent: "center",
        gap: 32,
      }}
    >
      <CanvasImage
        name="Котик лаунчера"
        src={staticFile("logo.png")}
        width={180}
        height={180}
        style={{
          scale: interpolate(frame, [0, 0.6 * fps], [0.88, 1], {
            extrapolateRight: "clamp",
          }),
        }}
      />
      <Interactive.H1
        name="Название лаунчера"
        style={{
          fontFamily: "Fredoka, sans-serif",
          fontWeight: 600,
          fontSize: 118,
          lineHeight: 1,
          margin: 0,
        }}
      >
        Femboy Launcher
      </Interactive.H1>
      <Interactive.P
        name="Приглашение"
        style={{ fontFamily: "Comfortaa, sans-serif", fontSize: 58, margin: 0 }}
      >
        Уютный уголок для твоего Minecraft
      </Interactive.P>
      <div
        style={{
          fontSize: 34,
          fontWeight: 700,
          color: "#85566f",
          marginTop: 10,
        }}
      >
        Windows 10 и 11 · 64-бит · Установщик и Portable
      </div>
      <div
        style={{
          borderRadius: 50,
          background: "#bb3978",
          color: "white",
          padding: "22px 52px",
          fontSize: 40,
          fontWeight: 800,
          marginTop: 20,
        }}
      >
        Скачай на этой странице
      </div>
    </AbsoluteFill>
  );
};
export const LauncherOverview = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      <TransitionSeries>
        <TransitionSeries.Sequence name="Сборки" durationInFrames={5.5 * fps}>
          <Feature
            title="Сборки под твои идеи"
            caption="Vanilla, Fabric, Quilt, Forge и NeoForge — в одном месте"
            shot="03-instances-sakura.png"
            chapter="01 / 05"
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 0.5 * fps })}
        />
        <TransitionSeries.Sequence name="Моды" durationInFrames={6.5 * fps}>
          <Feature
            title="Моды прямо в лаунчере"
            caption="Каталог Modrinth и установка нужных зависимостей"
            shot="06-mods-modrinth.png"
            chapter="02 / 05"
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 0.5 * fps })}
        />
        <TransitionSeries.Sequence name="Проверка" durationInFrames={5.5 * fps}>
          <Feature
            title="Проверка перед запуском"
            caption="Лаунчер подскажет, чего не хватает и какие моды конфликтуют"
            shot="10-health-check.png"
            offset={-210}
            chapter="03 / 05"
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 0.5 * fps })}
        />
        <TransitionSeries.Sequence name="Темы" durationInFrames={5.5 * fps}>
          <Feature
            title="Сакура днём. Полночь вечером."
            caption="Светлая и тёмная темы — выбирай под настроение"
            shot="04-instances-midnight.png"
            chapter="04 / 05"
            dark
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: 0.5 * fps })}
        />
        <TransitionSeries.Sequence name="Скачать" durationInFrames={4 * fps}>
          <Closing />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
