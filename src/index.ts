import $, { type } from 'jquery'

class Semaphore {
	availablePermits : number;
	maxCount : number;
	waiters : (() => void)[];
	waitAsync() {
		return new Promise<void>((resolve) => {
			if (this.availablePermits > 0) {
				this.availablePermits--;
				resolve();
			} else {
				this.waiters.push(() => resolve());
			}
		});
	}
	release() {
		if (this.waiters.length > 0) {
			const resolve = this.waiters.shift();
			resolve?.();
		} else if (this.availablePermits < this.maxCount) {
			this.availablePermits++;
		} else {
			throw new Error('Semaphore release error: max permit count exceeded.');
		}
	}
	constructor(initialCount : number, maxCount : number) {
		this.availablePermits = initialCount;
		this.maxCount = maxCount;
		this.waiters = [];
	}
}

async function getMangaList(page : number, pageSize : number, keyword : string) {
	try {

		let requestUrl = 'https://e-hentai.org/?f_search=' + keyword
		for (let i = 1; i < page; i++) {

			const html = await window.Rulia.httpRequest({
				url: requestUrl,
				method: 'GET',
				headers: {
					'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
				}
			})
			const nextUrl = $(html)
				.find('#unext')
				.attr('href')

			if (!nextUrl) {
				break
			}
			requestUrl = nextUrl
		}
		const rawStr = await window.Rulia.httpRequest({
			url: requestUrl,
			method: 'GET',
			headers: {
				'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
			}
		})
		const $html = $(rawStr)
		const $table = $html.find('.itg')
		const $mangaList = $table.find('tbody').children('tr')
		const result : IGetMangaListResult = {
			list: []
		}
		$mangaList.each((_ : number, el : HTMLElement) => {
			const $detail = $(el).find('.glthumb')
			const $image = $detail.find('div img')
			const $link = $(el).find('.gl3c a')
			const titleText = $image.attr('title') || ''
			const linkText = $link.attr('href') || ''
			const coverUrlText = $image.attr('data-src') || ''
			if (
				titleText !== '' &&
				linkText !== '' &&
				coverUrlText !== ''
			) {
				result.list.push({
					title: titleText,
					url: linkText,
					coverUrl: coverUrlText
				})

			}
		})
		window.Rulia.endWithResult(result)
	} catch (error) {
		window.Rulia.endWithException((error as Error).message)
	}
}

async function getMangaData(dataPageUrl : string) {
	try {
		const rawStr = await window.Rulia.httpRequest({
			url: dataPageUrl,
			method: 'GET',
			headers: {
				'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
			}
		})
		const $html = $(rawStr)
		const titleText = $html.find('#gn').text() || ''
		const chapterTitleText = $html.find('#gj').text() || 'Chapter 1'
		const $table = $html.find('#gdd')
		const $description = $table.find('tbody').children('tr')
		let descriptionText : string = ''
		$description.each((_, el) => {
			let key = $(el).find('.gdt1').text()
			let value = $(el).find('.gdt2').text()
			descriptionText += '[' + key + value + ']'
		})
		const coverStr = $html.find('#gd1 div').attr('style') || ''
		const coverUrlText = coverStr.match(/url\((['"]?)(.*?)\1\)/)?.[2] || ''
		const result : IGetMangaDataResult = {
			title: titleText,
			description: descriptionText,
			coverUrl: coverUrlText,
			chapterList: [
				{
					title: '[E-Hentai]' + chapterTitleText,
					url: dataPageUrl
				}
			]
		}
		window.Rulia.endWithResult(result);
	} catch (error) {
		window.Rulia.endWithException((error as Error).message)
	}

}

async function getChapterImageList(chapterUrl : string) {
	try {
		const chapterRawHTML = await window.Rulia.httpRequest({
			url: chapterUrl,
			method: 'GET'
		})
		const totalImageCountPattern = /<td class="gdt2">(\d+)\s*pages?<\/td>/;
		const totalImageCountMatch = chapterRawHTML.match(totalImageCountPattern);
		if (!totalImageCountMatch) {
			return window.Rulia.endWithException('TOO_MANY_REQUESTS');
		}
		const totalImageCount = parseInt(totalImageCountMatch[1])

		const allImagePageUrls : string[] = []
		if (totalImageCount != 0) {
			const PAGE_SIZE = 40
			const pageCount = Math.ceil(totalImageCount / PAGE_SIZE)
			const chapterPageUrls = [];

			for (let i = 0; i < pageCount; i++) {
				chapterPageUrls.push(chapterUrl + '?p=' + i);
			}
			const semaphore = new Semaphore(5, 5);
			const httpReponsePool : { urls : string[], index : number }[] = []
			const parseChapterPage = async (chapterPageUrl : string, index : number) => {
				await semaphore.waitAsync();
				const chapterPageHTML : any = await window.Rulia.httpRequest({
					url: chapterPageUrl,
					method: 'GET'
				});
				const imagePageUrlPattern = /https:\/\/e-hentai\.org\/s\/\S+?(?=">)/g;
				const imagePageUrls = chapterPageHTML.match(imagePageUrlPattern)
				httpReponsePool.push({
					index,
					urls: imagePageUrls
				})
				semaphore.release()
			}
			const tasks = chapterPageUrls.map((url, index) => parseChapterPage(url, index))
			await Promise.all(tasks);
			httpReponsePool.sort((a, b) => a.index - b.index)
			for (const httpResponse of httpReponsePool) {
				allImagePageUrls.push(...httpResponse.urls)
			}
		}
		{
			const semaphore = new Semaphore(8, 8);
			const httpReponsePool : { src : string, index : number }[] = []

			const getImageUrl = async (imagePageUrl : string, index : number) => {
				await semaphore.waitAsync();
				const pageUrlsRawResponse : any = await window.Rulia.httpRequest({
					url: imagePageUrl,
					method: 'GET'
				})
				const imageSrc = (
					(pageUrlsRawResponse.match(/<img\sid="img"\s[^>]*>/)[0]).match(/src="(https?:\/\/\S+)"/)[1]
				).replace(/src="|"/, '')
				httpReponsePool.push({
					index,
					src: imageSrc
				})
				semaphore.release()
			}
			const tasks = allImagePageUrls.map((item, index) => getImageUrl(item, index))
			await Promise.all(tasks)

			httpReponsePool.sort((a, b) => a.index - b.index)

			const imageUrls : string[] = httpReponsePool.map(item => item.src)
			window.Rulia.endWithResult(imageUrls.map(url => {
				return {
					url,
					width: 1,
					height: 1
				}
			}));
		}
	} catch (error) {
		window.Rulia.endWithException((error as Error).message);
	}
}

async function getImageUrl(path : string) {
	window.Rulia.endWithResult(path);
}