import { test } from "node:test"
import assert from "node:assert/strict"
import { peopleLabel } from "@/feat/activity/labels"
import { requestStep } from "@/feat/activity/requestStep"
import type { ActivityEvent } from "@/feat/activity/store"

const event = (kind: ActivityEvent["kind"], field?: string) =>
	({ userId: 1, at: 0, kind, ...(field ? { field } : {}) }) as ActivityEvent

test("a request is logged once, and corrected when the first look was wrong", () => {
	assert.equal(requestStep(undefined, "received"), "log")
	assert.equal(requestStep(undefined, "sent"), "log")
	assert.equal(requestStep("received", "received"), "skip", "Roblox sending the event twice")
	assert.equal(requestStep("sent", "received"), "correct", "the list lagged the event")
})

test("ended requests say who ended them when that is known", () => {
	assert.equal(peopleLabel(event("requestDeclined", "you"), true), "You declined")
	assert.equal(peopleLabel(event("requestDeclined", "them"), true), "Declined your request")
	assert.equal(peopleLabel(event("requestDeclined", "blockedYou"), true), "Blocked you")
	assert.equal(peopleLabel(event("requestDeclined", "blockedByYou"), true), "You blocked them")
	assert.equal(peopleLabel(event("requestDeclined", "ended"), true), "Their request ended")
	assert.equal(peopleLabel(event("requestDeclined"), true), "Request ended")
})

test("older guesses are not repeated as facts", () => {
	// "byYou" was guessed from the request's direction before, so it only says it ended.
	assert.equal(peopleLabel(event("requestDeclined", "byYou"), true), "Their request ended")
	assert.equal(peopleLabel(event("requestDeclined", "byThem"), true), "Declined your request")
})

test("accepting says which side accepted", () => {
	assert.equal(peopleLabel(event("friendAdded", "you"), true), "You accepted")
	assert.equal(peopleLabel(event("friendAdded", "them"), true), "Accepted your request")
	assert.equal(peopleLabel(event("friendAdded"), true), "Friend added")
})

test("unfriending only blames someone when it is known", () => {
	assert.equal(peopleLabel(event("friendRemoved", "you"), true), "You unfriended")
	assert.equal(peopleLabel(event("friendRemoved", "blockedYou"), true), "Blocked you")
	assert.equal(peopleLabel(event("friendRemoved"), true), "No longer friends")
	assert.equal(peopleLabel(event("friendRemoved"), false), "Friend removed")
})

test("follows read from whose log it is", () => {
	assert.equal(peopleLabel(event("followerAdded"), true), "Followed you")
	assert.equal(peopleLabel(event("followerAdded"), false), "Followed them")
	assert.equal(peopleLabel(event("followingRemoved"), true), "You unfollowed")
	assert.equal(peopleLabel(event("followingRemoved"), false), "They unfollowed")
})
