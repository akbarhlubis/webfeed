/*
 * WebFeed
 * MK3 by Xynium
 * Soup3
 * 
 */

'use strict';

const Main = imports.ui.main;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;
const ExtensionUtils = imports.misc.extensionUtils;
const JsxmL = Me.imports.jsxml;
const Rss = Me.imports.rss;
const Atom = Me.imports.atom;
const {GLib, Gio,St,Clutter,GObject,Soup} = imports.gi;

const Gettext = imports.gettext.domain('webfeed');
const _ = Gettext.gettext;

const RSS_FEEDS_LIST_KEY = 'rss-feeds-list';
const UPDATE_INTERVAL_KEY = 'update-interval';
const ITEMS_VISIBLE_KEY = 'items-visible';
const DELETE_AFTER = "delete-after"
const OKFORNOTIF ="okfornotif";
const DURHOTISHOT =  "durationhotitem";
const DLYFORRX ="delayforreceive";

const _MS_PER_HOUR = 1000 * 60 * 60 ;

let webfeedClass;
let settings;
let feedsArray;
let rxAsync;
let secu;
 
const WebFeedClass  = GObject.registerClass(
class WebFeedClass extends PanelMenu.Button {
    
    _init() {
        super._init(0);

        this.httpSession = null;
        this._startIndex = 0;
        this.hotIndex=0;
       
        this.topBox = new St.BoxLayout();
        // top panel button
        this.icon = new St.Icon({
            gicon : Gio.icon_new_for_string( Me.dir.get_path()+ '/rss_green.png' ),
            style_class: 'webfeed-icon-size'
        });
        this.topBox.add_child(this.icon)
        this.add_child(this.topBox);
        
        //Menu
        this.feedsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this.feedsSection);
        
        //lign time
        this.TimeMenu = new PopupMenu.PopupBaseMenuItem({
            reactive: false
        });

        let customTimeBox = new St.BoxLayout({
            style_class: 'webfeed-time-box ',
            vertical: false,
            clip_to_allocation: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: false,
            x_expand: true,
            pack_start: false
        });
        
        this.lastUpdateTime = new St.Button({label: _("Last update")+': --:--'});
        customTimeBox.add_actor(this.lastUpdateTime);
        this.TimeMenu.add_actor(customTimeBox);
        this.menu.addMenuItem(this.TimeMenu);
        
        let separator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(separator);

        // buttons in bottom menu bar
        this._buttonMenu = new PopupMenu.PopupBaseMenuItem({
            reactive: false
        });

        let customButtonBox = new St.BoxLayout({
            style_class: 'webfeed-button-box ',
            vertical: false,
            clip_to_allocation: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
            x_expand: true,
            pack_start: false
        });
        
        let prevBtn = this.createRoundButton('go-previous');
        prevBtn.connect('clicked', () => {
            this.onPreviousBtnClicked();
        });
        customButtonBox.add_actor(prevBtn);
        

        let nextBtn = this.createRoundButton('go-next'); 
        nextBtn.connect('clicked', () => {
            this.onNextBtnClicked();
        });
        customButtonBox.add_actor(nextBtn);
        
         let reloadBtn = this.createRoundButton('view-refresh'); 
        reloadBtn.connect('clicked', () => {
            this.realoadRssFeeds();
        });
        customButtonBox.add_actor(reloadBtn);
     
        let settingsBtn = this.createRoundButton('emblem-system'); 
        settingsBtn.connect('clicked', () => {
            ExtensionUtils.openPrefs(); 
        });
        customButtonBox.add_actor(settingsBtn);
        
        this._buttonMenu.add_actor(customButtonBox);
        this.menu.addMenuItem(this._buttonMenu);
        
        try {
            // try to get default browser
            this._browser = Gio.app_info_get_default_for_uri_scheme("http").get_executable(); //get_commandline();
            log("Browser : " + this._browser);
        }
        catch (err) {
            log(err + ' (get default browser error)');
        }
        this.lastUpdateTime.set_label(_("Last update")+': ' + new Date().toLocaleTimeString());
        this.realoadRssFeeds();
    }
    
    createRoundButton(iconName) {
        let button = new St.Button();
        button.child = new St.Icon({
            icon_name: iconName,
            style_class: 'webfeed-button-action' 
        });
        return button;
    }

    // previous button clicked callback
    onPreviousBtnClicked(){
        this._startIndex -= settings.get_int(ITEMS_VISIBLE_KEY);
        if (this._startIndex < 0)
            this._startIndex = 0
        this.refreshMenuLst();
    }
    
    //  On next button clicked callback
    onNextBtnClicked (){
        if (this._startIndex + settings.get_int(ITEMS_VISIBLE_KEY) < settings.get_strv(RSS_FEEDS_LIST_KEY).length){
            this._startIndex += settings.get_int(ITEMS_VISIBLE_KEY);
            this._refreshExtensionUI();
        }
    }

    /*
     *  Returns JSON object that represents HTTP (GET method) parameters
     *  stored in URL
     *  url - HTTP request URL
     */
    getParametersAsJson(url) {
        if (url.indexOf('?') == -1)
            return "{}";

        let urlParams = url.substr(url.indexOf('?') + 1);
        let params = urlParams.split('&');

        let jsonObj = "{";
        for (let i = 0; i < params.length; i++){
            let pair = params[i].split('=');
            jsonObj += '"' + pair[0] + '":' + '"' + pair[1] + '"';
            if (i != params.length -1)
                jsonObj += ',';
        }
        jsonObj += "}";

        return jsonObj;
    }

    //reload of RSS feeds from sources set in settings
    realoadRssFeeds() {
        log("Reload all Feeds");
        if (this.timeout)
            GLib.source_remove(this.timeout);
            
        if (settings.get_strv(RSS_FEEDS_LIST_KEY).length!=0) {
            feedsArray=[];
            rxAsync=[];
            if (settings.get_strv(RSS_FEEDS_LIST_KEY)) {
                for (let i = 0; i < settings.get_strv(RSS_FEEDS_LIST_KEY).length; i++){
                    let url = settings.get_strv(RSS_FEEDS_LIST_KEY)[i];
                    let jsonObj = this.getParametersAsJson(url);

                    if (url.indexOf('?') != -1)
                        url = url.substr(0, url.indexOf('?'));

                    this.httpGetRequestAsync(url, JSON.parse(jsonObj), i);
                    rxAsync[i]=1;
                }
            } 
            //timer attente response
             this.wtforresptmr=GLib.timeout_add(GLib.PRIORITY_HIGH_IDLE,100, this.wtforresp.bind(this));
               secu=0;
        }
          //timeout if enabled
        if (settings.get_int(UPDATE_INTERVAL_KEY) > 0) {
           //log("Next scheduled reload after " + settings.get_int(UPDATE_INTERVAL_KEY)*60 + " seconds");
           this.timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT_IDLE,settings.get_int(UPDATE_INTERVAL_KEY)*60,  this.realoadRssFeeds.bind(this));
        }
        return GLib.SOURCE_REMOVE;
    }
    
    //wait for all response from http get
    //timer call it every 100ms
    // when all received kill timer
    // if after secu request not good throw an error an continue
    wtforresp(){
        let strNoResp="";
        if (this.wtforresptmr)
            GLib.source_remove(this.wtforresptmr);
        let allz=false;
        try{
            if (secu++>settings.get_int(DLYFORRX)) throw('ERROR : Http problem :');  //  has waited too long
            allz = rxAsync.every((value, index, array) =>{
                    return value==0 ;
            });
            if (!allz) {
                 this.wtforresptmr=GLib.timeout_add(GLib.PRIORITY_HIGH_IDLE,100, this.wtforresp.bind(this));
                 return GLib.SOURCE_REMOVE;
             }
        }
        catch(error){
            log(error);
             for (let i = 0; i < settings.get_strv(RSS_FEEDS_LIST_KEY).length; i++) {
                 if (rxAsync[i]==1){
               	   //log(settings.get_strv(RSS_FEEDS_LIST_KEY)[i]+" has not responded ");
               	   strNoResp+="\n"+settings.get_strv(RSS_FEEDS_LIST_KEY)[i]+_(" has not responded ");
                 }
             }
        }
        log('all response  in '+secu/10+' s');
        this.refreshMenuLst();
        this.lastUpdateTime.set_label(_("Last update")+': ' + new Date().toLocaleTimeString()+strNoResp);
        return GLib.SOURCE_REMOVE;
    }

    /*
    *  Creates asynchronous HTTP GET request 
    *  url - HTTP request URL without parameters
    *  params - JSON object of HTTP GET request parameters
    *  position - Position in RSS sources list
    */
    //from https://libsoup.org/libsoup-3.0/client-basic.html
    httpGetRequestAsync(url, params, position) {
        if (this.httpSession == null) this.httpSession = new Soup.Session();
        let message = Soup.Message.new_from_encoded_form(    'GET',    url,    Soup.form_encode_hash(params));
        this.httpSession.send_and_read_async(    message,    GLib.PRIORITY_DEFAULT,    null,    (session, result) => {
            if (message.get_status() === Soup.Status.OK) {
                let bytes = session.send_and_read_finish(result);
                if (bytes){
                    let decoder = new TextDecoder('utf-8');
                    let response = decoder.decode(bytes.get_data());
                    onDownload(response, position);
                    //log(`Response: ${response}`);
                }
                else rxAsync[position]=0;
            }else rxAsync[position]=0;
        });    
    }

    // Reloads feeds section
    refreshMenuLst() {
        let counter = 0;
        this.feedsSection.removeAll();
        this.EraseHotItem();
                
        for (let i = this._startIndex; i < feedsArray.length; i++) {
            if (feedsArray[i] && feedsArray[i].Items) {
                let old=((new Date()- this.ISODateParser(feedsArray[i].PublishDate)) / _MS_PER_HOUR); 
                if (old>settings.get_int(DELETE_AFTER)) continue;
                if (this.hotIndex<1) {
                    this.warmItem();
                }
                /*if ((old<(2*settings.get_int(UPDATE_INTERVAL_KEY)/60))&& (this.hotIndex<2)) { ne tient pas compte des titre paragraphe
                    this.hotItem(feedsArray[i].Title);
                }*/
                let nItems = feedsArray[i].Items.length;
                let subMenu = new PopupMenu.PopupSubMenuMenuItem(_("( ")+old.toFixed(1)+_("H ago) ")+feedsArray[i].Title+ ' (' + nItems + ') :') ; //(Encoder.htmlDecode(title) + ' (' + nitems + ')');
                for (let j = 0; j < nItems; j++) {
                    old=((new Date()- this.ISODateParser(feedsArray[i].Items[j].PublishDate)) / _MS_PER_HOUR); 
                    if (old>settings.get_int(DELETE_AFTER)) continue;
                    if ((old<(settings.get_int(DURHOTISHOT)/60))&& (this.hotIndex<2)) {
                        this.hotItem(feedsArray[i].Items[j].Title);
                    }
                    let menuItem = new PopupMenu.PopupMenuItem( _("( ")+old.toFixed(1)+_("H ago) ")+feedsArray[i].Items[j].Title);  //(Encoder.htmlDecode(title) + ' (' + nitems + ')');
                    subMenu.menu.addMenuItem(menuItem);
                    //subMenu.menu.addAction( ("("+old.toFixed(1)+"H ago) "+feedsArray[i].Items[j].Title), null, 'view-refresh-symbolic'); 
                    menuItem.connect('activate', ()=>{
                           log("Opening browser : "+this._browser+" with link : " +  feedsArray[i].Items[j].HttpLink);
                           try{
                               Util.trySpawnCommandLine(this._browser + ' ' + feedsArray[i].Items[j].HttpLink);
                           }
                           catch (err) {
                               log(err + ' (launch browser error or snap install )');
                           }
                    });
                }
                this.feedsSection.addMenuItem(subMenu);   
            }
            else {
                let subMenu = new PopupMenu.PopupMenuItem(_("No data available"));
                this.feedsSection.addMenuItem(subMenu);
            }
            counter++;
            if (counter == settings.get_int(ITEMS_VISIBLE_KEY))
                break;
        }
    }

    ISODateParser (datestr) {
        return new Date(datestr);
    }
    
    //notif new item
    hotItem(strItm){
        this.hotIndex=2;     
        this.topBox.remove_all_children();
        this.icon =  new St.Icon({
            gicon : Gio.icon_new_for_string( Me.dir.get_path()+ '/rss_red.png' ),
            style_class: 'webfeed-icon-size'
        });
        this.topBox.add_child(this.icon);
    
        if (settings.get_boolean(OKFORNOTIF)) {
            let notification = new MessageTray.Notification(
                Main.messageTray,
                "RSS Update", // Title
                strItm // Subtitle
            );
            notification.setTransient(true); // Agar otomatis hilang setelah beberapa detik
            Main.messageTray.add(notification);
        }
    }
    
    //il y a des reponses
    warmItem(){
        this.hotIndex=1;
         this.topBox.remove_all_children();
        this.icon =  new St.Icon({
            gicon : Gio.icon_new_for_string( Me.dir.get_path()+ '/rss_yelow.png' ),
            style_class: 'webfeed-icon-size'
        });
        this.topBox.add_child(this.icon)
    }
    
    EraseHotItem(){
        this.hotIndex=0;
        this.topBox.remove_all_children();
        this.icon = new St.Icon({
            gicon : Gio.icon_new_for_string( Me.dir.get_path()+ '/rss_green.png' ),
            style_class: 'webfeed-icon-size'
        });
        this.topBox.add_child(this.icon)
     }
     
    destroy(){
        if (this.wtforresptmr)
            GLib.source_remove(this.wtforresptmr);
        if (this.timeout)
            GLib.source_remove(this.timeout);
        this.timeout=null;  
        this.wtforresptmr =null;
        super.destroy();
    }
});

/*
 *  On HTTP request response callback 
 *  responseData - response data
 *  position - Position in feed sources list
 */
function onDownload(responseData, position) {
    let xmlDoc = new JsxmL.REXML(responseData);
    let feedParser;
          
    if (xmlDoc.rootElement.name.toLowerCase().slice(0, 3) == 'rss'){  // 3 est la length de rss
        //log('RSS ');
        feedParser= new Rss.RssParser(xmlDoc.rootElement);
    }
    
    if (xmlDoc.rootElement.name.toLowerCase().slice(0, 4) == 'feed'){
        //log('ATOM');
        feedParser= new Atom.AtomParser(xmlDoc.rootElement);
    }
    
    if (feedParser==null) {           // entré ni rss ni atom
        log('Bad XML nor RSS nor ATOM'); 
        return; 
    }

    if (feedParser.Items.length > 0)
    {
        let Feed = new class{
               constructor(){
                this.Title= feedParser.Title; 
                this.HttpLink=  feedParser.HttpLink;
                this.PublishDate=feedParser.PublishDate;
                this.Items= [];
            } };
       
        for (let i = 0; i < feedParser.Items.length; i++) {
            let item = new class{
               constructor(){
                 this.Title= feedParser.Items[i].Title;
                 this.HttpLink=  feedParser.Items[i].HttpLink;
                 this.PublishDate=feedParser.Items[i].PublishDate;
            }};
            Feed.Items.push(item);
        }
       feedsArray[position] = Feed;
       rxAsync[position]=0;
    } 
    else{
        log('Bad XML or no item in it'); 
        rxAsync[position]=0;
        return; 
    }
}


function init() {
    ExtensionUtils.initTranslations('webfeed');
}


function enable() {
    settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.webfeed');  
    webfeedClass = new WebFeedClass();
    Main.panel.addToStatusArea('WebFeed', webfeedClass, 0, 'right');
}


function disable() {
    webfeedClass.destroy();
    webfeedClass=null;
    settings=null;
    feedsArray=null;
    rxAsync=null;
    secu=null;
}
