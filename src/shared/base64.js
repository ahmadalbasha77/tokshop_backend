const fs = require("fs");

decode = (imgs, id, date) => {

	if (date == null) {
		if (Array.isArray(imgs)) {
			imgs.forEach((img) => {
				const split = img.split(",");
				const base64Data = split[1];
				let index = imgs.indexOf(img);
				fs.writeFileSync("./public/img/" + index + "_" + id + ".png", base64Data, "base64");
			});
		} else {
			const split = imgs.split(",");
			const base64Data = split[1];
			fs.writeFileSync("./public/img/" + id + ".png", base64Data, "base64");
		}
	} else {

		if (Array.isArray(imgs)) {
			imgs.forEach((img) => {
				const split = img.split(",");
				const base64Data = split[1];
				let index = imgs.indexOf(img);
				fs.writeFileSync("./public/img/" + date + index + "_" + id + ".png", base64Data, "base64");
			});
		} else {
			const split = imgs.split(",");
			const base64Data = split[1];
			fs.writeFileSync("./public/img/" + date + "_" + id + ".png", base64Data, "base64");
		}
	}

};

module.exports = decode;