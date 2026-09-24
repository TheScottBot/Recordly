import { MicrophoneIcon, MicrophoneSlashIcon } from "@phosphor-icons/react";
import type { ReactElement, ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAudioLevelMeter } from "@/hooks/useAudioLevelMeter";
import { AudioLevelMeter } from "@/components/ui/audio-level-meter";
import styles from "../LaunchWindow.module.css";
import "../launchTheme.css";
import type { DeviceOption } from "./launchPopoverTypes";
import { useHudInteraction } from "../contexts/HudInteractionContext";

export function DropdownItem({
	onClick,
	selected,
	disabled,
	disabledReason,
	icon,
	children,
	trailing,
}: {
	onClick: () => void;
	selected?: boolean;
	disabled?: boolean;
	/**
	 * Why it cannot be used, shown on hover and read out by a screen reader.
	 * A disabled control that does not say why is a dead end, and the dimming
	 * alone carries no meaning to anyone who cannot see it.
	 */
	disabledReason?: string;
	icon: ReactNode;
	children: ReactNode;
	trailing?: ReactNode;
}) {
	return (
		<button
			type="button"
			className={[
				styles.ddItem,
				selected ? styles.ddItemSelected : "",
				disabled ? styles.ddItemDisabled : "",
			]
				.filter(Boolean)
				.join(" ")}
			onClick={onClick}
			disabled={disabled}
			title={disabled ? disabledReason : undefined}
		>
			<span className="shrink-0">{icon}</span>
			<span className="truncate">{children}</span>
			{trailing}
		</button>
	);
}

export function MicDeviceRow({
	device,
	selected,
	onSelect,
}: {
	device: DeviceOption;
	selected: boolean;
	onSelect: () => void;
}) {
	const { level } = useAudioLevelMeter({
		enabled: true,
		deviceId: device.deviceId,
	});

	return (
		<button
			type="button"
			className={`${styles.ddItem} ${selected ? styles.ddItemSelected : ""}`}
			onClick={onSelect}
		>
			<span className="shrink-0">
				{selected ? <MicrophoneIcon size={16} /> : <MicrophoneSlashIcon size={16} />}
			</span>
			<span className="truncate flex-1">{device.label}</span>
			<AudioLevelMeter level={level} className="w-16 shrink-0" />
		</button>
	);
}

export function HudPopover({
	open,
	onOpenChange,
	trigger,
	children,
	align = "center",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger: ReactElement;
	children: ReactNode;
	align?: "start" | "center" | "end";
}) {
	const { onMouseEnter } = useHudInteraction();
	return (
		<Popover open={open} onOpenChange={onOpenChange} modal={false}>
			<PopoverTrigger asChild>{trigger}</PopoverTrigger>
			<PopoverContent
				className={`launch-theme ${styles.menuCard} ${styles.electronNoDrag}`}
				data-hud-interactive
				unstyled
				side="top"
				align={align}
				sideOffset={8}
				avoidCollisions
				collisionPadding={10}
				usePortal={false}
				onMouseEnter={onMouseEnter}
			>
				{children}
			</PopoverContent>
		</Popover>
	);
}
