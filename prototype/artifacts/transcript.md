# FlashBan walkthrough

## A calmer web

FlashBan is a local-first browser protection prototype. This walkthrough shows the working demo, real measurements, and the extension. No flashing source will be revealed.

## 01 · Start with a clean signal

First, a calm source. FlashBan samples real pixels and covers new content while the first measurement window fills. A clean source is allowed, and monitoring continues.

## 02 · Measure rapid changes

Next, a synthetic rapid-change source. It stays covered. The shared detector counts opposing luminance transitions, then stops the source behind a static shield. These numbers come from the sampled pixels.

## 03 · Choose the sensitivity

Standard sensitivity waits for more than three completed general flashes in the last second. This is a general-flash prototype, not a certification of compliance or safety.

## 04 · Fail closed

Unreadable media is guarded too. This scene triggers a real cross-origin canvas restriction in the browser. FlashBan does not pretend to have measured pixels it cannot read.

## 05 · Respect reduced motion

Reduced-motion preferences disable visual tests. A measurements-only replay runs the detector on an off-screen source. The result stays readable without displaying the test pattern.

## 06 · Keep the history local

Each decision appears in this tab’s session history. There are no accounts, uploads, or analytics. The interface explains what was measured and what remains outside the prototype.

## 07 · Install the browser extension

The fork also includes an unpacked Chrome extension using the same detector. Load the extension folder in Chrome developer mode. It covers new sources, samples them, and keeps a local event log.

## 08 · The installed shield

This is captured evidence from the actual unpacked extension in Chromium. The extension detected the canvas source and covered it. Separate tests also verified CSS animation, generated video, and the local popup log.

## Built to be tested

The prototype has repeatable unit and browser tests. Red flashes, animated-image decoding, adversarial hardening, and guaranteed protection remain out of scope. This is an engineering prototype, not a medical device.