import { test } from "node:test"
import assert from "node:assert/strict"
import { RBXInstance } from "@/rbx/Parser/ModelParser"

const uri = (Uri: string) => ({ SourceType: 1, Uri })

test("A Content-only MeshPart reads under its old names", () => {
	const part = new RBXInstance("MeshPart")
	part.setProperty("MeshContent", uri("rbxassetid://1"), "Content")
	part.setProperty("TextureContent", uri("rbxassetid://2"), "Content")

	assert.equal(part.MeshId, "rbxassetid://1")
	assert.equal(part.TextureId, "rbxassetid://2")
	assert.equal(part.getProperty("MeshID", true), "rbxassetid://1")
	assert.equal(part.getProperty("TextureId"), "rbxassetid://2")
	assert.equal(part.getProperty("TextureID"), undefined)
	assert.equal("MeshId" in part.Properties, false)
})

test("An old property with a value wins over the Content one, whichever comes first", () => {
	const first = new RBXInstance("SpecialMesh")
	first.setProperty("MeshId", "rbxassetid://old", "string")
	first.setProperty("MeshContent", uri("rbxassetid://new"), "Content")
	assert.equal(first.MeshId, "rbxassetid://old")

	const last = new RBXInstance("SpecialMesh")
	last.setProperty("MeshContent", uri("rbxassetid://new"), "Content")
	last.setProperty("MeshId", "rbxassetid://old", "string")
	assert.equal(last.MeshId, "rbxassetid://old")
})

test("An empty old property falls back to the Content url", () => {
	const shirt = new RBXInstance("Shirt")
	shirt.setProperty("ShirtTemplate", "", "string")
	shirt.setProperty("ShirtTemplateContent", uri("rbxassetid://3"), "Content")

	assert.equal(shirt.ShirtTemplate, "rbxassetid://3")
	assert.equal(shirt.getProperty("ShirtTemplate"), "rbxassetid://3")
})

test("A Content value without a url adds nothing", () => {
	const decal = new RBXInstance("Decal")
	decal.setProperty("TextureContent", { SourceType: 0 }, "Content")

	assert.equal(decal.Texture, undefined)
	assert.equal(decal.getProperty("Texture"), undefined)
})
