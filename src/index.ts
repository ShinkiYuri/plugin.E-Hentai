interface IHentagApi<T> {
  works: T,
  page: number,
  pageSize: number
}

interface IHentagMangaListItem {
  title: string,
  id: string,
  coverImageUrl: string
}

class Semaphore {
  availablePermits: number;
  maxCount: number;
  waiters: (() => void)[];
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
      resolve?.(); // Invoke the resolve function
    } else if (this.availablePermits < this.maxCount) {
      this.availablePermits++;
    } else {
      throw new Error('Semaphore release error: max permit count exceeded.');
    }
  }
  constructor(initialCount: number, maxCount: number) {
    this.availablePermits = initialCount;
    this.maxCount = maxCount;
    this.waiters = [];
  }
}


async function getMangaList(page: number, pageSize: number, keyword: string) {
  const url = 'https://hentag.com/public/api/vault-search';
  try {
    const payload = new URLSearchParams({});
    payload.append('p', page.toString());
    payload.append('s', pageSize.toString());
    if (keyword) {
      payload.append('t', keyword.toString());
    }
    const rawResponse = await window.Rulia.httpRequest({
      url: url,
      method: 'GET',
      payload: payload.toString()
    });
    const response = JSON.parse(rawResponse) as IHentagApi<IHentagMangaListItem[]>;
    const result: IGetMangaListResult = {
      list: response.works.map(item => ({
        title: item.title,
        url: 'https://hentag.com/vault/' + item.id,
        coverUrl: item.coverImageUrl
      }))
    }
    window.Rulia.endWithResult(result);
  } catch (error) {
    window.Rulia.endWithException((error as Error).message);
  }
}

async function getMangaData(dataPageUrl: string) {
  const seasonIdMatchExp = /vault\/([^?]+)/;
  const seasonIdMatch: RegExpMatchArray | any = dataPageUrl.match(seasonIdMatchExp);
  const url = 'https://hentag.com/public/api/vault/' + seasonIdMatch[1];
  try {
    const rawResponse = await window.Rulia.httpRequest({
      url: url,
      method: 'GET'
    });
    const response = JSON.parse(rawResponse);
    const description = new Date(response.lastModified).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-').replace(/-/g, '/');
    const result = {
      title: response.title,
      description: description,
      coverUrl: response.coverImageUrl,
      chapterList: [{
        title: '[e-hentai]' + response.title,
        url: response.locations[0]
      }]
    }
    window.Rulia.endWithResult(result);
  } catch (error) {
    window.Rulia.endWithException((error as Error).message);
  }
}

async function getChapterImageList(chapterUrl: string) {
  try {
    let pageSize: number = 0;
    let urls = [chapterUrl];
    let chapterUrls: string[] = [];
    const pageRawResponse = await window.Rulia.httpRequest({
      url: chapterUrl,
      method: 'GET'
    })
    const pageSizePattern = /<td class="gdt2">(\d+)\s*pages?<\/td>/;
    const pageSizeMatch = pageRawResponse.match(pageSizePattern);
    if (!pageSizeMatch) {
      return window.Rulia.endWithException('TOO_MANY_REQUESTS');
    }
    pageSize = parseInt(pageSizeMatch[1]);
    if (pageSize != 0) {
      for (let i = 1; i <= Math.ceil(pageSize / 40); i++) {
        urls.push(chapterUrl + '?p=' + i);
      }
      const semaphore = new Semaphore(5, 5);
      const exec = async (url: string) => {
        await semaphore.waitAsync();
        const chapterUrlsRawResponse: any = await window.Rulia.httpRequest({
          url: url,
          method: 'GET'
        });
        const chapterUrlsPattern = /https:\/\/e-hentai\.org\/s\/\S+?(?=">)/g;
        for (let item of (chapterUrlsRawResponse.match(chapterUrlsPattern))) {
          chapterUrls.push(item);
        }
        semaphore.release();
      }
      const tasks = urls.map(url => exec(url));
      await Promise.all(tasks);
    }
    // Get image url.
    {
      const semaphore = new Semaphore(8, 8);
      const pageUrls: string[] = [];
      const exec = async (item: any) => {
        await semaphore.waitAsync();
        try {
          const pageUrlsRawResponse: any = await window.Rulia.httpRequest({
            url: item,
            method: 'GET'
          });
          const pageUrl = (
            (pageUrlsRawResponse.match(/<img\sid="img"\s[^>]*>/)[0]).match(/src="(https?:\/\/\S+)"/)[1]
          ).replace(/src="|"/, '');

          pageUrls.push(pageUrl);
        } finally {
          semaphore.release();
        }
      };
      const sequentialExec = async () => {
        for (const item of chapterUrls) {
          await exec(item);
        }
      };
      await sequentialExec();
      const result = pageUrls.map(item => ({
        url: item,
        width: 1,
        height: 1
      }));
      window.Rulia.endWithResult(result);
    }
  } catch (error) {
    window.Rulia.endWithException((error as Error).message);
  }
}

async function getImageUrl(path: string) {
  window.Rulia.endWithResult(path);
}
