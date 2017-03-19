<legend>Add Groceries</legend>
<label>Name</label>
<input class="name" value="{{name}}" />
<label>Quantity</label>
<input class="quantity" type="number" value="{{quantity}}"/>
<button class="add">Add</button>
{{#error}}
<p>{{error}}</p>
{{/error}}
<a href="#items" class="cancel">Cancel</a>
